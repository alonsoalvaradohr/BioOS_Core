/**
 * ==============================================================================
 * ARCHIVO: 01b_LLM_Gateway.gs
 * SISTEMA: BioOS v4.1 (Arquitectura SRE)
 * DESCRIPCIÓN: Pasarela Universal de Modelos LLM.
 * HITO 1.3 (Paso 1): Evolución a Soporte Multimodal (Texto, Audio, Visión).
 * Mantiene compatibilidad absoluta (Backwards-Compatible) con llamadas de texto.
 * ==============================================================================
 */

// [P0] LISTA BLANCA ESTRICTA (Generación Gemini 3.x de Google AI Studio)
const _GEMINI_WHITELIST = [
  "gemini-3.6-flash",         // [1] Primario: Rápido, multimodal y estructurado
  "gemini-3.5-flash-lite",    // [2] Secundario: Ultra ligero y fallback rápido
  "gemini-3.1-pro-preview"    // [3] Avanzado: Razonamiento complejo y Pro
];

const _MAX_DAILY_REQUESTS = 200;

/**
 * Endpoint universal para invocar a Gemini. Todos los agentes pasan por aquí.
 *
 * @param {string} systemPrompt - Instrucciones del sistema (ROM).
 * @param {object|string|Array} userPayload - Datos a analizar o Array Multimodal.
 * @param {object} schema - (Opcional) Esquema JSON estricto.
 * @param {number} temperature - Nivel de determinismo.
 */
function invokeUniversalLLM(systemPrompt, userPayload, schema = null, temperature = 0.1) {
  const props = PropertiesService.getScriptProperties();
  const rawApiKey = props.getProperty("GEMINI_API_KEY");
  if (!rawApiKey) throw new Error("[SYS_PANIC] GEMINI_API_KEY ausente en Script Properties.");
  const apiKey = String(rawApiKey).trim();

  let lastErrorCode = 0;
  let lastErrorText = "";

  // 2. Evolución Multimodal: Detecta si el payload es un array nativo de partes Gemini
  let requestParts;
  if (Array.isArray(userPayload)) {
    requestParts = userPayload; // Carga multimodal preparada (ej. Audio Base64 + Texto)
  } else {
    // Modo Legacy Text/JSON
    requestParts = [{ "text": typeof userPayload === 'string' ? userPayload : JSON.stringify(userPayload) }];
  }

  // 3. Bucle de Enrutamiento y Fallback Ultra-Rápido
  for (let i = 0; i < _GEMINI_WHITELIST.length; i++) {
    const targetModel = _GEMINI_WHITELIST[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const payload = {
      "systemInstruction": { "parts": [{ "text": systemPrompt }] },
      "contents": [{ "role": "user", "parts": requestParts }],
      "generationConfig": {
        "temperature": Math.max(0, Math.min(2, Number(temperature) || 0))
      }
    };

    if (schema) {
      payload.generationConfig.responseMimeType = "application/json";
      payload.generationConfig.responseSchema = schema;
    }

    try {
      _checkAndConsumeDailyQuota();
    } catch (quotaErr) {
      console.warn(`[GATEWAY_QUOTA_WARN] ${quotaErr.message}`);
    }

    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (netErr) {
      console.warn(`[GATEWAY_FETCH_ERR] Error de conexión con ${targetModel}: ${netErr.message}`);
      lastErrorCode = 503;
      lastErrorText = netErr.message;
      continue;
    }

    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code === 200) {
      try {
        const json = JSON.parse(text);
        if (!json.candidates || json.candidates.length === 0 || !json.candidates[0].content || !json.candidates[0].content.parts || !json.candidates[0].content.parts[0]) {
          throw new Error(`[API_FAULT] Vector nulo devuelto por ${targetModel}`);
        }

        const rawText = json.candidates[0].content.parts[0].text;
        if (i > 0 && typeof sendSystemTelemetry === "function") {
          sendSystemTelemetry("WARNING", `[GATEWAY] Límite evadido. Conmutación exitosa a modelo: ${targetModel}`);
        }

        if (schema) {
          try {
            return JSON.parse(rawText);
          } catch (parseErr) {
            const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
              return JSON.parse(jsonMatch[1]);
            }
            throw parseErr;
          }
        }
        return rawText;
      } catch (parseCandidateErr) {
        console.warn(`[GATEWAY_PARSE_WARN] Error extrayendo respuesta de ${targetModel}: ${parseCandidateErr.message}`);
        lastErrorText = parseCandidateErr.message;
        continue;
      }

    } else {
      lastErrorCode = code;
      lastErrorText = text;
      console.warn(`[GATEWAY_FAIL] Modelo ${targetModel} devolvió HTTP ${code}: ${text.substring(0, 300)}`);

      let isModalityMismatch = (code === 400 && (text.includes("modalities") || text.includes("not supported")));
      const isRotatable = [400, 403, 404, 429, 500, 502, 503, 504].includes(code) || isModalityMismatch;

      if (isRotatable) {
        if (typeof sendSystemTelemetry === "function") {
          sendSystemTelemetry("WARNING", `[GATEWAY] Nodo ${targetModel} colapsó (HTTP ${code}). Rotando a siguiente...`);
        }

        // Backoff únicamente ante saturación (429/503), rotación instantánea ante 404/400
        if (code === 429 || code === 503) {
          Utilities.sleep(Math.min(2000, 500 * (i + 1)));
        }
        continue;
      } else {
        throw new Error(`[API_FAULT] Rechazo ineludible (HTTP ${code}). Detalle: ${text.substring(0, 300)}`);
      }
    }
  }

  throw new Error(`[API_EXHAUSTED] Todos los modelos fallaron. Último código: HTTP ${lastErrorCode}. Detalle: ${lastErrorText.substring(0, 300)}`);
}

/**
 * ==============================================================================
 * CIRCUIT BREAKER DE CUOTA DIARIA (Free-Tier Protection)
 * ==============================================================================
 */
function _checkAndConsumeDailyQuota() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    const today = new Date().toISOString().split('T')[0];
    const savedDate = props.getProperty("QUOTA_DATE");
    let currentUsage = parseInt(props.getProperty("QUOTA_USAGE") || "0", 10);
    if (savedDate !== today) {
      currentUsage = 0;
      props.setProperty("QUOTA_DATE", today);
    }
    if (currentUsage >= _MAX_DAILY_REQUESTS) {
      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("FATAL", `[QUOTA_BREAKER] Presupuesto diario LLM agotado (${currentUsage}/${_MAX_DAILY_REQUESTS}).`);
      throw new Error("[QUOTA_EXHAUSTED] Límite de seguridad alcanzado. Red paralizada.");
    }
    props.setProperty("QUOTA_USAGE", (currentUsage + 1).toString());
  } finally {
    lock.releaseLock();
  }
}
/**
 * Utilidad SRE: Resetea manualmente el contador de cuota diaria de la pasarela.
 */
function resetDailyLLMQuota() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("QUOTA_USAGE", "0");
  props.setProperty("QUOTA_DATE", new Date().toISOString().split('T')[0]);
  console.log("🛠️ [SRE] Contador de cuota LLM reseteado a 0 exitosamente.");
}

/**
 * ==============================================================================
 * ARCHIVO: 05_Bio_Compiler.gs
 * SISTEMA: BioOS v4.1 (Arquitectura SRE)
 * DESCRIPCIÓN: Agente Compilador Biométrico (MOMA & SRC).
 * HITO 1.3 (Paso 3 Final): Ingesta Acústica. Traducción nativa de Base64 Audio
 * a tensores cualitativos usando inferencia multimodal en el Gateway.
 * ==============================================================================
 */

function compileBiometricTelemetry(rhr, sleep, steps) {
  return executeWithResilience("Compiler_Biometrics", () => {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", "Compilador MOMA: Cuantizando telemetría y auditando ceguera sensorial...");

    let isSleepOffline = (!sleep || sleep === 0);
    let isRHROffline = (!rhr || rhr === 0);

    if (isSleepOffline && typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[MOMA] Sensor de sueño inalcanzable. Falsificación matemática bloqueada.");
    if (isRHROffline && typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[MOMA] Sensor PPG inalcanzable. Falsificación matemática bloqueada.");

    // Inyección honesta: Si no hay dato, se declara offline para que el clúster deduzca.
    const payload = recordProvenance(
      {
        raw_rhr: isRHROffline ? "SENSOR_OFFLINE" : rhr,
        raw_sleep: isSleepOffline ? "SENSOR_OFFLINE" : sleep,
        raw_steps: steps
      },
      "TicWatch_FitAPI",
      false
    );

    const schema = {
      "type": "OBJECT",
      "properties": {
        "tokens_fisiologicos": { "type": "ARRAY", "items": { "type": "STRING" } },
        "nivel_ruido_estimado": { "type": "STRING", "enum": ["BAJO", "MEDIO", "ALTO"] },
        "vector_carga_snc": { "type": "NUMBER" },
        "alerta_ceguera_sensorial": {
          "type": "BOOLEAN",
          "description": "True si faltan métricas clave (RHR o Sueño) que impiden un cálculo determinista."
        }
      },
      "required": ["tokens_fisiologicos", "nivel_ruido_estimado", "vector_carga_snc", "alerta_ceguera_sensorial"]
    };

    const prompt = `Eres el Agente Compilador Biométrico de BioOS v5.0.
REGLA SRE DE HIERRO: ESTÁ ESTRICTAMENTE PROHIBIDO INVENTAR NÚMEROS.
Si un parámetro llega como "SENSOR_OFFLINE", no lo adivines. Tu tarea es aplicar alineación ortogonal a la telemetría disponible. Si hay ceguera sensorial, debes emitir un token fisiológico que diga explícitamente "[DATO_FALTANTE] Requiere contexto cualitativo o feedback del usuario".
Calcula el vector_carga_snc únicamente en base a los datos que sí posees.`;

    const compiledData = invokeUniversalLLM(prompt, payload, schema, 0.1);

    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("SUCCESS", `Alineación biométrica completada. Ceguera Sensorial Activa: ${compiledData.alerta_ceguera_sensorial}`);
    return compiledData;
  });
}

function compileQualitativeFeedback(rawInput) {
  return executeWithResilience("Compiler_NLP", () => {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", "Compilador MOMA: Extrayendo subespacios cualitativos y prospectivos...");

    let isVoice = false;
    let rawText = rawInput;
    let ingressItems = [];

    // Typed ingress supports mixed text/voice batches while retaining the
    // former single-voice envelope for backwards compatibility.
    try {
      const parsed = JSON.parse(rawInput);
      if (parsed._type === "multimodal_voice" && parsed.data) {
        ingressItems = [{ kind: "voice", mimeType: parsed.mimeType || "audio/ogg", data: parsed.data, eventId: parsed.eventId || "legacy" }];
      } else if (parsed._type === "bioos_ingress_batch" && Array.isArray(parsed.items)) {
        ingressItems = parsed.items.slice(0, 10);
      }
    } catch (e) {
      ingressItems = [];
    }

    const schema = {
      "type": "OBJECT",
      "properties": {
        "sintomatologia_fisica": { "type": "ARRAY", "items": { "type": "STRING" } },
        "carga_alostatica_percibida": { "type": "ARRAY", "items": { "type": "STRING" } },
        "adherencia_nutricional": {
          "type": "ARRAY",
          "items": { "type": "STRING" },
          "description": "Lista detallada de ingestas (ej. Pizza, Pera, Tamales, Cerveza)."
        },
        "intenciones_futuras": {
          "type": "ARRAY",
          "items": { "type": "STRING" },
          "description": "Planes operativos del usuario (ej. 'Correr a las 4 AM', 'Descansar rodilla')."
        }
      },
      "required": ["sintomatologia_fisica", "carga_alostatica_percibida", "adherencia_nutricional", "intenciones_futuras"]
    };

    const prompt = `Eres el Agente Compilador Multimodal de BioOS v5.0.
Extrae EXCLUSIVAMENTE vectores de estado biológico, psicológico y nutricional estructurados. Presta máxima atención a "adherencia_nutricional" e "intenciones_futuras" para dotar al clúster de memoria prospectiva y contexto metabólico.`;

    let userPayloadParam;

    if (ingressItems.length) {
      const parts = [];
      const texts = [];
      ingressItems.forEach(function(item) {
        if (item && item.kind === "voice") {
          if (typeof item.data !== "string" || !item.data || item.data.length > 12000000) throw new Error("[VOICE_PAYLOAD_INVALID] Audio ausente o demasiado grande.");
          const mimeType = typeof item.mimeType === "string" && /^audio\/[a-z0-9.+-]+$/i.test(item.mimeType) ? item.mimeType : "audio/ogg";
          parts.push({ inlineData: { mimeType: mimeType, data: item.data } });
          isVoice = true;
        } else if (item && item.kind === "text" && typeof item.text === "string" && item.text.trim()) {
          texts.push(item.text.trim());
        }
      });
      const combinedText = texts.join("\n[SIGUIENTE_MENSAJE]: ").substring(0, 100000);
      if (isVoice) {
        parts.unshift({ text: "Mensajes de texto asociados:\n" + combinedText + "\nEscucha las notas de voz y extrae únicamente la información cualitativa solicitada." });
        userPayloadParam = parts;
      } else {
        userPayloadParam = recordProvenance({ text: combinedText }, "Telegram_Text_Batch", false);
      }
    } else {
      userPayloadParam = recordProvenance({ text: rawText }, "Telegram_Text", false);
    }

    if (isVoice && typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", "[MOMA] Procesando inferencia acústica (Voice-to-JSON)...");

    const compiledData = invokeUniversalLLM(prompt, userPayloadParam, schema, 0.1);

    if (typeof sendSystemTelemetry === "function") {
      const intentionsCount = compiledData.intenciones_futuras ? compiledData.intenciones_futuras.length : 0;
      sendSystemTelemetry("SUCCESS", `NLP cuantizado (Modo: ${isVoice ? 'Audio' : 'Texto'}). Subespacios prospectivos aislados: ${intentionsCount}`);
    }

    return compiledData;
  });
}

function applySpeculativeRetrospectiveCorrection(realRhr, realSleep, inferredRhr, inferredSleep, historicalTokens) {
  return executeWithResilience("Compiler_SRC", () => {
    const rhrDelta = Math.abs(realRhr - inferredRhr);
    const sleepDelta = Math.abs(realSleep - inferredSleep);

    if (rhrDelta <= 4 && sleepDelta <= 1.0) {
      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", `[SRC] Desviación dentro del margen seguro. NVRAM validada.`);
      return null;
    }

    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[SRC] Desviación crítica post-sincronización. Iniciando Retroceso...`);

    const payload = recordProvenance({
      realidad_sincronizada: { rhr: realRhr, sleep: realSleep },
      inferencia_pasada: { rhr: inferredRhr, sleep: inferredSleep },
      tokens_contaminados: historicalTokens
    }, "TicWatch_Delayed_Sync", false);

    const schema = {
      "type": "OBJECT",
      "properties": {
        "tokens_ortogonales_corregidos": { "type": "ARRAY", "items": { "type": "STRING" } },
        "impacto_diagnostico": { "type": "STRING", "enum": ["MENOR", "MODERADO", "CRITICO"] },
        "justificacion_reescritura": { "type": "STRING" }
      },
      "required": ["tokens_ortogonales_corregidos", "impacto_diagnostico", "justificacion_reescritura"]
    };

    const prompt = `Eres el Módulo SRC de BioOS v5.0. Compara la realidad recién ingresada vs la inferencia pasada. Genera los vectores fisiológicos corregidos absolutos.`;

    const correctedData = invokeUniversalLLM(prompt, payload, schema, 0.1);

    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("SUCCESS", `[SRC] Retroceso exitoso. Impacto: ${correctedData.impacto_diagnostico}.`);
    return correctedData;
  });
}

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

    const hasRhr = (rhr !== undefined && rhr !== null && rhr !== 0 && rhr !== "SENSOR_OFFLINE" && isFinite(Number(rhr)) && Number(rhr) > 0);
    const hasSleep = (sleep !== undefined && sleep !== null && sleep !== 0 && sleep !== "SENSOR_OFFLINE" && isFinite(Number(sleep)) && Number(sleep) > 0);
    const hasSteps = (steps !== undefined && steps !== null && steps !== "SENSOR_OFFLINE" && isFinite(Number(steps)) && Number(steps) >= 0);

    if (!hasSleep && typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[MOMA] Sensor de sueño inalcanzable. Falsificación matemática bloqueada.");
    if (!hasRhr && typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[MOMA] Sensor PPG inalcanzable. Falsificación matemática bloqueada.");

    // Inyección honesta: Si el dato existe se preserva el número real; si no, se declara offline
    const payload = recordProvenance(
      {
        raw_rhr: hasRhr ? Number(rhr) : "SENSOR_OFFLINE",
        raw_sleep: hasSleep ? Number(sleep) : "SENSOR_OFFLINE",
        raw_steps: hasSteps ? Number(steps) : "SENSOR_OFFLINE"
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
Si los datos biométricos están presentes como números válidos, debes cuantizarlos fielmente en tokens fisiológicos preservando los valores numéricos exactos (RHR bpm, sueño, pasos).
Si un parámetro llega como "SENSOR_OFFLINE", no lo adivines. Tu tarea es aplicar alineación ortogonal a la telemetría disponible. Si hay ceguera sensorial (falta RHR o Sueño), debes marcar alerta_ceguera_sensorial = true y emitir un token fisiológico que diga explícitamente "[DATO_FALTANTE] Requiere contexto cualitativo o feedback del usuario".
Calcula el vector_carga_snc únicamente en base a los datos que sí posees.`;

    const compiledData = invokeUniversalLLM(prompt, payload, schema, 0.1);
    if (compiledData && typeof compiledData === 'object') {
      compiledData.raw_metrics = {
        rhr: hasRhr ? Number(rhr) : null,
        sleep: hasSleep ? Number(sleep) : null,
        steps: hasSteps ? Number(steps) : null
      };
      if (!hasRhr || !hasSleep) {
        compiledData.alerta_ceguera_sensorial = true;
      }
    }

    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("SUCCESS", `Alineación biométrica completada. Ceguera Sensorial Activa: ${compiledData && compiledData.alerta_ceguera_sensorial}`);
    return compiledData;
  });
}

function compileQualitativeFeedback(rawInput) {
  return executeWithResilience("Compiler_NLP", () => {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", "Compilador MOMA: Extrayendo subespacios cualitativos y prospectivos...");

    let isVoice = false;
    let isPhoto = false;
    let rawText = rawInput;
    let ingressItems = [];

    try {
      const parsed = typeof rawInput === 'object' ? rawInput : JSON.parse(rawInput);
      if (parsed._type === "multimodal_voice" && parsed.data) {
        ingressItems = [{ kind: "voice", mimeType: parsed.mimeType || "audio/ogg", data: parsed.data, eventId: parsed.eventId || "legacy" }];
      } else if (parsed._type === "multimodal_photo" && parsed.data) {
        ingressItems = [{ kind: "photo", mimeType: parsed.mimeType || "image/jpeg", data: parsed.data, caption: parsed.caption || "", eventId: parsed.eventId || "legacy" }];
      } else if (parsed._type === "bioos_ingress_batch" && Array.isArray(parsed.items)) {
        ingressItems = parsed.items.slice(0, 10);
      } else if (Array.isArray(parsed)) {
        ingressItems = parsed.slice(0, 10);
      } else if (parsed.kind === "voice" || parsed.kind === "photo") {
        ingressItems = [parsed];
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
          "description": "Lista detallada de alimentos ingeridos, estimación calórica y desglose de macronutrientes (Proteínas, Carbos, Grasas)."
        },
        "intenciones_futuras": {
          "type": "ARRAY",
          "items": { "type": "STRING" },
          "description": "Planes operativos o compromisos del usuario para inyectar en Google Tasks."
        },
        "activity_metrics": { "type": "ARRAY", "items": { "type": "OBJECT", "properties": {
          "source_app": { "type": "STRING" }, "activity_date_local": { "type": "STRING" },
          "cadence_avg_spm": { "type": "NUMBER" }, "cadence_max_spm": { "type": "NUMBER" },
          "stride_avg_cm": { "type": "NUMBER" }, "stride_max_cm": { "type": "NUMBER" }
        }, "required": ["source_app", "activity_date_local", "cadence_avg_spm", "cadence_max_spm", "stride_avg_cm", "stride_max_cm"] }, "description": "Métricas técnicas de carrera legibles en captura; independientes de que distancia/tiempo estén visibles." },
        "activity_sessions": { "type": "ARRAY", "items": { "type": "OBJECT", "properties": {
          "source_app": { "type": "STRING" }, "activity_date_local": { "type": "STRING" }, "activity_time_local": { "type": "STRING" },
          "distance_km": { "type": "NUMBER" }, "duration_seconds": { "type": "NUMBER" }, "displayed_avg_pace_seconds_per_km": { "type": "NUMBER" },
          "average_heart_rate_bpm": { "type": "NUMBER" }, "max_heart_rate_bpm": { "type": "NUMBER" }, "steps": { "type": "NUMBER" },
          "active_calories_kcal": { "type": "NUMBER" }, "total_calories_kcal": { "type": "NUMBER" }
        }, "required": ["source_app", "activity_date_local", "activity_time_local", "distance_km", "duration_seconds", "displayed_avg_pace_seconds_per_km", "average_heart_rate_bpm", "max_heart_rate_bpm", "steps", "active_calories_kcal", "total_calories_kcal"] }, "description": "Solo reportes de ejercicio visibles en imágenes; usa 0 o cadena vacía para dato ausente/ilegible." }
      },
      "required": ["sintomatologia_fisica", "carga_alostatica_percibida", "adherencia_nutricional", "intenciones_futuras", "activity_metrics", "activity_sessions"]
    };

    const prompt = `Eres el Agente Compilador Multimodal de BioOS v5.2 (Audio, Imagen, Texto).
Analiza las entradas (notas de voz, fotos de alimentos, texto) y extrae:
1. "sintomatologia_fisica": Molestias musculares, articulares o fatiga.
2. "carga_alostatica_percibida": Nivel de estrés mental o cognitivo.
3. "adherencia_nutricional": Alimentos detectados en texto o fotografiados, con estimación de calorías y desglose de macros (Proteínas, Carbohidratos, Grasas).
4. "intenciones_futuras": Compromisos, tareas a realizar o sesiones de running planeadas.
5. "activity_metrics": extrae por separado cadencia media/máxima y zancada media/máxima si aparecen, incluso si la captura es solo un panel técnico sin fecha/distancia. Usa 0 si el dato no aparece; no confundas SPM con pasos por pierna.
6. "activity_sessions": solo cuando una imagen muestre claramente una actividad deportiva; copia los números legibles y el origen visible, usa 0/cadena vacía para cualquier campo ilegible o ausente. No adivines fecha, distancia, ritmo ni frecuencia cardíaca y no conviertas pasos/calorías en distancia. El tiempo y ritmo mostrados son del usuario/app, no telemetría directa de Google Fit.`;

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
        } else if (item && item.kind === "photo") {
          if (typeof item.data !== "string" || !item.data || item.data.length > 12000000) throw new Error("[PHOTO_PAYLOAD_INVALID] Foto ausente o demasiado grande.");
          parts.push({ inlineData: { mimeType: item.mimeType || "image/jpeg", data: item.data } });
          if (item.caption) texts.push("Descripción adjunta a la foto: " + item.caption);
          isPhoto = true;
        } else if (item && item.kind === "text" && typeof item.text === "string" && item.text.trim()) {
          texts.push(item.text.trim());
        }
      });
      const combinedText = texts.join("\n[SIGUIENTE_MENSAJE]: ").substring(0, 100000);
      if (isVoice || isPhoto) {
        parts.unshift({ text: "Contexto textual:\n" + (combinedText || "Sin texto adicional.") + "\nAnaliza los elementos adjuntos y devuelve el JSON solicitado." });
        userPayloadParam = parts;
      } else {
        userPayloadParam = recordProvenance({ text: combinedText }, "Telegram_Text_Batch", false);
      }
    } else {
      userPayloadParam = recordProvenance({ text: rawText }, "Telegram_Text", false);
    }

    if ((isVoice || isPhoto) && typeof sendSystemTelemetry === "function") {
      sendSystemTelemetry("PROCESS", `[MOMA] Procesando inferencia multimodal (${isVoice ? 'Audio ' : ''}${isPhoto ? 'Foto ' : ''})...`);
    }

    let compiledData = null, analysisErrorCode = '';
    try { compiledData = invokeUniversalLLM(prompt, userPayloadParam, schema, 0.1); }
    catch (error) { analysisErrorCode = (typeof Core_normalizeError === 'function' ? Core_normalizeError(error).code : 'VISION_INFERENCE_FAILED'); }
    if (!compiledData || typeof compiledData !== 'object') compiledData = { sintomatologia_fisica: [], carga_alostatica_percibida: [], adherencia_nutricional: [], intenciones_futuras: [], activity_metrics: [], activity_sessions: [] };
    compiledData.activity_metrics = Array.isArray(compiledData.activity_metrics) ? compiledData.activity_metrics : [];
    compiledData.activity_sessions = Array.isArray(compiledData.activity_sessions) ? compiledData.activity_sessions : [];
    compiledData.photo_analysis_status = isPhoto ? (analysisErrorCode ? 'inference_unavailable:' + analysisErrorCode : (compiledData.activity_metrics.length || compiledData.activity_sessions.length ? 'activity_evidence_extracted' : 'no_activity_metrics_extracted')) : 'no_photo';
    if (compiledData && typeof compiledData === 'object') {
      var photoEvents = ingressItems.filter(function(item) { return item && item.kind === 'photo'; }).map(function(item) { return String(item.eventId || ''); });
      (Array.isArray(compiledData.activity_sessions) ? compiledData.activity_sessions : []).forEach(function(session, index) {
        if (session && typeof session === 'object') session.evidenceEventId = photoEvents[Math.min(index, Math.max(0, photoEvents.length - 1))] || '';
      });
      (Array.isArray(compiledData.activity_metrics) ? compiledData.activity_metrics : []).forEach(function(metrics, index) {
        if (metrics && typeof metrics === 'object') metrics.evidenceEventId = photoEvents[Math.min(index, Math.max(0, photoEvents.length - 1))] || '';
      });
    }

    if (typeof sendSystemTelemetry === "function") {
      const intentionsCount = compiledData.intenciones_futuras ? compiledData.intenciones_futuras.length : 0;
      sendSystemTelemetry("SUCCESS", `NLP cuantizado (Modo: ${isVoice ? 'Audio' : isPhoto ? 'Foto' : 'Texto'}). Subespacios prospectivos: ${intentionsCount}`);
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

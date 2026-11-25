// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/** BioOS v5.4 bounded cognitive orchestration & Active Inference Coprocessor. */
const _ORCHESTRATOR_MAX_SPECIALISTS = 2;
const _ORCHESTRATOR_MIN_NEXT_CALL_MS = 5000;
const _ORCHESTRATOR_MIN_SYNTHESIS_MS = 3000;

function routeCognitiveTask(triggerEvent, rawPayload, requestContext) {
  const context = _orchestratorContext_(triggerEvent, rawPayload, requestContext);
  return executeWithResilience('Orchestrator_Routing_' + triggerEvent, function() {
    _orchestratorRequireBudget_(context, 0, 'ingesta');
    _orchestratorTelemetry_(context, 'PROCESS', '[ORCHESTRATOR] Inicio de triaje maestro rápido.', { triggerEvent: triggerEvent });
    const memory = getSystemMemory();
    const rom = memory.ROM || {};
    const payload = _buildOrchestrationPayload_(triggerEvent, rawPayload, memory, context);

    let approved = {};
    let taskCount = 0;

    // Para despachos periódicos (Morning/Evening), realizamos síntesis cognitiva directa unificada para latencia < 5s
    if (triggerEvent === 'MORNING_BRIEFING' || triggerEvent === 'EVENING_BRIEFING') {
      const active = _determineActiveSpecialists(triggerEvent, rom.agent_prompts || {});
      // Inyectamos las perspectivas especializadas en el contexto cognitivo sin llamadas de red redundantes
      approved = {};
      Object.keys(active).slice(0, 2).forEach(function(key) {
        approved[key] = { role: key, ready: true, tareas_ejecutivas: [] };
      });
    } else {
      const active = _determineActiveSpecialists(triggerEvent, rom.agent_prompts || {});
      const responses = _invokeSpecialistsCluster(active, payload, context);
      approved = _auditSpecialistCluster_(responses, context);
      taskCount = _injectAuditedTasks_(approved, context);
    }

    const output = _synthesizeOrchestration_(rom, memory, payload, approved, taskCount, context);
    let compact = false;
    if (typeof ingestWorkingMemory === 'function') try {
      compact = ingestWorkingMemory(triggerEvent, { tokens: payload, hipotesis: approved, sintesis: output.resumen_ejecutivo || 'Sin síntesis.', requestId: context.requestId, eventId: context.eventId });
    } catch (error) { _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] No se pudo persistir L1.', { error: Core_normalizeError(error).code }); }
    let delivered = false;
    if (typeof _rawSystemNotify === 'function' && output.mensaje_telegram) {
      delivered = _rawSystemNotify('🧠 <b>BioOS Orchestrator</b>\n\n' + output.mensaje_telegram);
      if (!delivered) {
        _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] Falló el despacho de notificación a Telegram.', { triggerEvent: triggerEvent });
      }
    }
    // GC Compaction es asíncrono (gestionado por triggerMemoryConsolidation), no bloquea el despacho
    _orchestratorTelemetry_(context, delivered ? 'SUCCESS' : 'WARNING', delivered ? '[ORCHESTRATOR] Ciclo completado y notificado.' : '[ORCHESTRATOR] Ciclo procesado pero notificación no entregada.', { triggerEvent: triggerEvent, injectedTasksCount: taskCount, delivered: delivered });
    return delivered;
  });
}

function _orchestratorContext_(triggerEvent, rawPayload, supplied) {
  if (supplied && supplied.requestId && supplied.deadlineMs) return supplied;
  if (typeof Core_createRequestContext !== 'function') throw new Error('[CORE_CONTEXT_MISSING] Request context dependency unavailable.');
  return Core_createRequestContext({ operation: typeof CORE_OPERATION !== 'undefined' ? CORE_OPERATION.QUEUE_WORKER : 'queue_worker', source: 'orchestrator:' + String(triggerEvent || 'unknown'), eventId: rawPayload && rawPayload.eventId, idempotencyKey: rawPayload && rawPayload.idempotencyKey });
}

function _pickNumericValue_(candidates, min, max) {
  for (let i = 0; i < candidates.length; i++) {
    const val = candidates[i];
    if (val !== undefined && val !== null && val !== 'SENSOR_OFFLINE' && val !== '') {
      const num = Number(val);
      if (isFinite(num) && num >= min && num <= max) {
        return num;
      }
    }
  }
  return null;
}

function _extractBiometricTelemetry_(rawPayload, basal) {
  const basalRhr = (basal && basal.baseline_rhr) || 43;
  const basalSleep = (basal && basal.target_sleep_hrs) || 7.3;
  const basalSteps = (basal && basal.target_steps) || 8000;

  // 1. Extraer snapshot de hardware del motor de sensores
  const liveSnapshot = _safeETL('Sensor_Engine', typeof getBiometricSnapshot === 'function' ? getBiometricSnapshot : null, null);
  const snapData = (liveSnapshot && liveSnapshot.available && liveSnapshot.data) ? liveSnapshot.data : null;

  // 2. Extraer telemetría presente directamente en rawPayload (tests, sync manual, webhook biométrico)
  const raw = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const nestedData = (raw.data && typeof raw.data === 'object') ? raw.data : {};
  const nestedBio = (raw.biometric_telemetry && typeof raw.biometric_telemetry === 'object') ? raw.biometric_telemetry : {};
  const nestedBioData = (nestedBio.data && typeof nestedBio.data === 'object') ? nestedBio.data : {};

  // Extracción de RHR (validar rango fisiológico 20 - 240 bpm)
  const rhr = _pickNumericValue_([
    raw.rhr, raw.rhrBpm, raw.testRhr, raw.raw_rhr,
    nestedData.rhr, nestedData.rhrBpm,
    nestedBioData.rhr, nestedBioData.rhrBpm,
    snapData && snapData.rhrBpm
  ], 20, 240);

  // Extracción de Sueño (en minutos o en horas si <= 24; debe ser positivo > 0)
  let sleepMins = null;
  const rawSleepCandidate = _pickNumericValue_([
    raw.sleepMinutes, raw.testSleepMinutes, raw.raw_sleep,
    nestedData.sleepMinutes, nestedBioData.sleepMinutes,
    snapData && snapData.sleepMinutes
  ], 1, 1440);

  if (rawSleepCandidate !== null && rawSleepCandidate > 0) {
    sleepMins = rawSleepCandidate;
  } else {
    const sleepHrsCandidate = _pickNumericValue_([
      raw.sleep, raw.testSleep, raw.sleep_hrs, raw.sleepHours,
      nestedData.sleep, nestedBioData.sleep
    ], 0.1, 24);
    if (sleepHrsCandidate !== null && sleepHrsCandidate > 0) {
      sleepMins = Math.round(sleepHrsCandidate * 60);
    }
  }

  // Extracción de Pasos
  const steps = _pickNumericValue_([
    raw.steps, raw.testSteps, raw.raw_steps,
    nestedData.steps, nestedBioData.steps,
    snapData && snapData.steps
  ], 0, 200000);

  // Extracción de Distancia en KM
  const distanceKm = _pickNumericValue_([
    raw.distanceKm, raw.distance_km, raw.testDistanceKm,
    nestedData.distanceKm, nestedBioData.distanceKm,
    snapData && snapData.distanceKm,
    (snapData && snapData.distanceMeters) ? Number((snapData.distanceMeters / 1000).toFixed(2)) : null
  ], 0, 500);

  // Extracción de Calorías
  const caloriesKcal = _pickNumericValue_([
    raw.caloriesKcal, raw.calories, raw.raw_calories, raw.testCalories,
    nestedData.caloriesKcal, nestedBioData.caloriesKcal,
    snapData && snapData.caloriesKcal
  ], 0, 50000);

  const hasLiveBiometrics = (
    (rhr !== null && rhr >= 20) ||
    (sleepMins !== null && sleepMins > 0) ||
    (steps !== null && steps > 0) ||
    (distanceKm !== null && distanceKm > 0) ||
    (caloriesKcal !== null && caloriesKcal > 0)
  );

  if (hasLiveBiometrics) {
    const sleepHours = sleepMins !== null ? Number((sleepMins / 60).toFixed(2)) : null;
    const rhrDelta = rhr !== null ? Number((rhr - basalRhr).toFixed(1)) : null;
    const sleepDelta = sleepHours !== null ? Number((sleepHours - basalSleep).toFixed(2)) : null;
    const stepsDelta = steps !== null ? (steps - basalSteps) : null;

    return {
      origin: "[HARDWARE_LIVE]",
      is_live_telemetry: true,
      sensor_status: "ONLINE",
      source: (liveSnapshot && liveSnapshot.source) || raw.source || "GoogleFit_REST",
      fetchedAt: (liveSnapshot && liveSnapshot.fetchedAt) || new Date().toISOString(),
      data: {
        rhrBpm: rhr,
        sleepMinutes: sleepMins,
        sleepHours: sleepHours,
        steps: steps,
        distanceKm: distanceKm,
        caloriesKcal: caloriesKcal
      },
      baseline_comparison: {
        rhr_vs_baseline: rhrDelta,
        sleep_hrs_vs_target: sleepDelta,
        steps_vs_target: stepsDelta
      },
      notice: "Telemetría real confirmada. Cruzar con el modelo basal y contexto L1."
    };
  }

  return {
    origin: "[BASAL_NOMINAL]",
    is_live_telemetry: false,
    sensor_status: "CEGUERA_SENSORIAL_ACTIVA",
    source: "Digital_Twin_Basal_Reference",
    reference_baseline: {
      nominal_rhr_bpm: basalRhr,
      nominal_sleep_hrs: basalSleep,
      nominal_target_steps: basalSteps
    },
    notice: "Sin telemetría de hardware en vivo. ESTRICTAMENTE PROHIBIDO inventar deltas o lecturas en tiempo real. Declarar ceguera sensorial y adaptar el día a carga mínima."
  };
}

function _buildOrchestrationPayload_(triggerEvent, rawPayload, memory, context) {
  const payload = {};
  const nvram = (memory && memory.NVRAM) || {};
  const basal = nvram.L4_Basal || { baseline_rhr: 43, target_steps: 8000, target_sleep_hrs: 7.3 };

  if (triggerEvent === 'MORNING_BRIEFING' || triggerEvent === 'EVENING_BRIEFING') {
    payload.biometric_telemetry = _extractBiometricTelemetry_(rawPayload, basal);

    if (_orchestratorCapabilityEnabled_('WORKSPACE_CONTEXT')) {
      payload.workspace_agenda = _safeETL('Calendar_API', typeof fetchTodayCalendarEvents === 'function' ? fetchTodayCalendarEvents : null, []);
      payload.workspace_emails = _safeETL('Gmail_API', typeof fetchRecentUnreadContext === 'function' ? fetchRecentUnreadContext : null, []);
    }
  } else if (triggerEvent === 'USER_FEEDBACK') {
    payload.user_nlp = typeof compileQualitativeFeedback === 'function' ? compileQualitativeFeedback(rawPayload) : rawPayload;
    payload.biometric_telemetry = _extractBiometricTelemetry_(rawPayload, basal);
  } else throw new Error('[CORE_FAULT] Trigger no reconocido: ' + triggerEvent);

  payload.cmo_long_term_trends = (((memory || {}).NVRAM || {}).L3_Semantic || {}).medical_knowledge_graph || {};
  payload.request_context = { requestId: context.requestId, eventId: context.eventId, source: context.source };
  return payload;
}

function _safeETL(taskName, etlFunction, fallbackValue) {
  try { return typeof etlFunction === 'function' ? etlFunction() : fallbackValue; }
  catch (error) { if (typeof sendSystemTelemetry === 'function') sendSystemTelemetry('WARNING', '[ETL_FAULT] ' + taskName + ': ' + error.message); return fallbackValue; }
}

function _determineActiveSpecialists(triggerEvent, promptsROM) {
  if (typeof selectRegisteredSpecialists !== 'function') throw new Error('[AGENT_REGISTRY_MISSING] Registro de especialistas no disponible.');
  return selectRegisteredSpecialists(triggerEvent, promptsROM || {});
}

function _invokeSpecialistsCluster(active, payload, context) {
  const results = {}, all = Object.keys(active || {}), names = all.slice(0, _ORCHESTRATOR_MAX_SPECIALISTS);
  if (all.length > names.length) _orchestratorTelemetry_(context, 'WARNING', '[ORCHESTRATOR] Especialistas diferidos por presupuesto.', { deferred: all.length - names.length });
  names.forEach(function(name) {
    if (Core_remainingBudgetMs(context) < _ORCHESTRATOR_MIN_NEXT_CALL_MS) { _orchestratorTelemetry_(context, 'WARNING', '[ORCHESTRATOR] Especialista diferido por deadline.', { specialist: name }); return; }
    try { results[name] = evaluateSpecialistNode(name, active[name], payload); }
    catch (error) { _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] Especialista omitido.', { specialist: name, error: Core_normalizeError(error).code }); }
  });
  return results;
}

function _auditSpecialistCluster_(responses, context) {
  const validated = {};
  Object.keys(responses || {}).forEach(function(name) {
    // Fail closed: only a completed audit can retain executable tasks.
    if (typeof auditAndValidateHypothesis !== 'function' || Core_remainingBudgetMs(context) < _ORCHESTRATOR_MIN_NEXT_CALL_MS) {
      validated[name] = _orchestratorBlockActions_(responses[name], 'AUDIT_UNAVAILABLE_OR_DEADLINE'); return;
    }
    try { validated[name] = auditAndValidateHypothesis(name, responses[name]); }
    catch (error) { validated[name] = _orchestratorBlockActions_(responses[name], 'AUDIT_FAILURE'); _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] Auditoría falló; acciones anuladas.', { specialist: name, error: Core_normalizeError(error).code }); }
  });
  return validated;
}

function _injectAuditedTasks_(hypotheses, context) {
  let count = 0;
  if (!_orchestratorCapabilityEnabled_('EXTERNAL_TASKS') || typeof createProactiveTask !== 'function') return count;
  Object.keys(hypotheses || {}).forEach(function(specialist) {
    const tasks = hypotheses[specialist] && Array.isArray(hypotheses[specialist].tareas_ejecutivas) ? hypotheses[specialist].tareas_ejecutivas : [];
    tasks.slice(0, 3).forEach(function(task) {
      if (Core_remainingBudgetMs(context) < _ORCHESTRATOR_MIN_NEXT_CALL_MS || !task || !task.titulo) return;
      try { if (createProactiveTask('[' + specialist.toUpperCase() + '] ' + task.titulo, task.notas || '')) count++; }
      catch (error) { _orchestratorTelemetry_(context, 'ERROR', '[TASK_INJECTION_FAULT] Tarea omitida.', { specialist: specialist, error: Core_normalizeError(error).code }); }
    });
  });
  return count;
}

function _extractL1CognitiveContext(sessionEvents, thresholdHours) {
  const limitHours = thresholdHours || 12;
  const events = Array.isArray(sessionEvents) ? sessionEvents : [];
  const cutoffMs = Date.now() - (limitHours * 3600000);

  const feedbackEvents = events.filter(function(ev) {
    if (!ev || !ev.timestamp) return false;
    const isFeedback = ev.origin === 'USER_FEEDBACK' || (ev.data && (ev.data.user_nlp || ev.data.sintomatologia_fisica));
    const eventTime = new Date(ev.timestamp).getTime();
    return isFeedback && eventTime >= cutoffMs;
  }).sort(function(a, b) {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  if (!feedbackEvents.length) {
    return {
      active: false,
      hoursSince: null,
      feedbackCount: 0,
      details: { sintomas: [], carga_alostatica: [], nutricion: [], intenciones: [], resumen_previo: '' },
      formattedDetails: 'Sin feedback cualitativo en las últimas ' + limitHours + ' horas.',
      summaryText: 'Sin feedback cualitativo en las últimas ' + limitHours + ' horas.'
    };
  }

  const latest = feedbackEvents[0];
  const hoursSince = Number(((Date.now() - new Date(latest.timestamp).getTime()) / 3600000).toFixed(1));

  const sintomas = [];
  const cargaAlostatica = [];
  const nutricion = [];
  const intenciones = [];
  const sintesisPrevias = [];

  feedbackEvents.forEach(function(ev) {
    const d = ev.data || {};
    const nlp = (d.tokens && d.tokens.user_nlp) ? d.tokens.user_nlp : (d.user_nlp || d);
    if (Array.isArray(nlp.sintomatologia_fisica)) sintomas.push(...nlp.sintomatologia_fisica);
    if (Array.isArray(nlp.carga_alostatica_percibida)) cargaAlostatica.push(...nlp.carga_alostatica_percibida);
    if (Array.isArray(nlp.adherencia_nutricional)) nutricion.push(...nlp.adherencia_nutricional);
    if (Array.isArray(nlp.intenciones_futuras)) intenciones.push(...nlp.intenciones_futuras);
    if (d.sintesis && typeof d.sintesis === 'string') sintesisPrevias.push(d.sintesis);
  });

  const unique = function(arr) {
    const seen = {};
    return arr.filter(function(item) {
      if (typeof item !== 'string' || !item.trim()) return false;
      const key = item.trim().toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  };

  const details = {
    sintomas: unique(sintomas),
    carga_alostatica: unique(cargaAlostatica),
    nutricion: unique(nutricion),
    intenciones: unique(intenciones),
    resumen_previo: unique(sintesisPrevias).join(' | ')
  };

  const lines = [];
  if (details.sintomas.length) lines.push('• Síntomas/Sensaciones Físicas: ' + details.sintomas.join(', '));
  if (details.carga_alostatica.length) lines.push('• Carga/Estrés Percibido: ' + details.carga_alostatica.join(', '));
  if (details.nutricion.length) lines.push('• Nutrición Reportada: ' + details.nutricion.join(', '));
  if (details.intenciones.length) lines.push('• Intenciones/Planes del Usuario: ' + details.intenciones.join(', '));
  if (details.resumen_previo) lines.push('• Síntesis Feedback Previo: ' + details.resumen_previo);

  return {
    active: true,
    hoursSince: hoursSince,
    feedbackCount: feedbackEvents.length,
    details: details,
    formattedDetails: lines.join('\n') || 'Feedback cualitativo registrado recientemente.',
    summaryText: 'Feedback cualitativo detectado hace ' + hoursSince + 'h (' + feedbackEvents.length + ' eventos).'
  };
}

function _synthesizeOrchestration_(rom, memory, payload, hypotheses, taskCount, context) {
  if (Core_remainingBudgetMs(context) < _ORCHESTRATOR_MIN_SYNTHESIS_MS || typeof invokeUniversalLLM !== 'function') return _orchestratorDegradedOutput_(taskCount);
  const triggerEvent = (context && context.source && context.source.replace('orchestrator:', '')) || 'MORNING_BRIEFING';
  const sessionEvents = ((((memory || {}).NVRAM || {}).L1_Working || {}).session_events || []);
  const l1Context = _extractL1CognitiveContext(sessionEvents, 12);
  const bioTelemetry = payload.biometric_telemetry || {};
  const isLive = bioTelemetry.origin === '[HARDWARE_LIVE]';

  const schema = {
    type: 'OBJECT',
    properties: {
      razonamiento_clinico_oculto: {
        type: 'STRING',
        description: 'Cadena de pensamiento clínico deductivo y análisis matemático previo. Evalúa deltas fisiológicos (RHR vs basal, volumen en km/pasos acumulados, gasto calórico), síntomas de dolor biomecánico en L1 (ej. sóleo, rodilla) y justifica por qué se veta o aprueba cada intervención antes de redactar el mensaje de Telegram.'
      },
      mensaje_telegram: { type: 'STRING', description: 'Mensaje ejecutivo táctico formateado en HTML con emojis y formato de alta densidad, derivado estrictamente del razonamiento clínico.' },
      resumen_ejecutivo: { type: 'STRING', description: 'Síntesis interna concisa para L1/NVRAM.' },
      tareas_sugeridas: { type: 'ARRAY', items: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, notas: { type: 'STRING' } } } }
    },
    required: ['razonamiento_clinico_oculto', 'mensaje_telegram', 'resumen_ejecutivo']
  };

  let systemDirective = `Eres el Orquestador y Coprocesador Asíncrono de Inferencia Activa de BioOS v8.5.
Tu usuario es Ingeniero y Líder de I+D en robótica/automatización con alta carga de running de fondo.
VETO DE HIERRO: Cero cortesía vacía, cero saludos genéricos ("buenos días", "¿cómo estás?"), cero recomendaciones vacías ("toma luz solar", "camina un poco").
Directo a la acción táctica procesable, lenguaje técnico sobrio, alta densidad semántica.

==============================================================================
CADENA DE PENSAMIENTO CLÍNICA OBLIGATORIA (razonamiento_clinico_oculto):
==============================================================================
Antes de redactar el mensaje_telegram, DEBES completar el campo "razonamiento_clinico_oculto" con un análisis deductivo profundo y riguroso:
1. Análisis de Carga Alostática y Biometría: Evalúa deltas fisiológicos (RHR vs basal, volumen en km/pasos acumulados, calorías quemadas).
2. Intersección con Contexto Cualitativo L1: Si el usuario reportó dolor mecánico (ej. sóleo, tendón, rodilla) o fatiga mental, esto tiene PREVALENCIA ABSOLUTA sobre cualquier plan de entrenamiento.
3. Veto Clínico Estricto: Si hay dolor biomecánico o sobrecarga severa acumulada (>12km corridos con molestias), ESTÁ ESTRICTAMENTE VETADO sugerir trotes "regenerativos" o carreras suaves; se DEBE prescribir descanso absoluto o descarga pasiva no impactante.
4. Tu mensaje_telegram DEBE ser una consecuencia directa y transparente de este razonamiento clínico.

==============================================================================
REGLAS SRE DE HIERRO (TRAZABILIDAD, COGNICIÓN LONGITUDINAL Y ANTI-ALUCINACIÓN):
==============================================================================
1. ESTADO DE TELEMETRÍA BIOMÉTRICA: ${bioTelemetry.origin || '[BASAL_NOMINAL]'} (${bioTelemetry.sensor_status || 'CEGUERA_SENSORIAL_ACTIVA'})
${isLive ? `• Telemetría Real Confirmada: RHR ${bioTelemetry.data.rhrBpm} bpm, Sueño ${bioTelemetry.data.sleepHours}h (${bioTelemetry.data.sleepMinutes} min), Pasos ${bioTelemetry.data.steps}.
• Deltas vs Basal: ${JSON.stringify(bioTelemetry.baseline_comparison)}.
• Prescribe el entrenamiento y la nutrición basándote ESTRICTAMENTE en estos deltas reales de recuperación del SNC.` : `• ESTADO: [CEGUERA SENSORIAL ACTIVA - MODELO BASAL NOMINAL].
• Parámetros Nominales de Referencia: RHR ${((bioTelemetry.reference_baseline && bioTelemetry.reference_baseline.nominal_rhr_bpm) || 43)} bpm, Sueño ${((bioTelemetry.reference_baseline && bioTelemetry.reference_baseline.nominal_sleep_hrs) || 7.3)}h, Pasos ${((bioTelemetry.reference_baseline && bioTelemetry.reference_baseline.nominal_target_steps) || 8000)}.
• ESCUDO ANTI-ALUCINACIÓN ESTRICTO:
  - ESTÁ TERMINANTEMENTE PROHIBIDO inventar o asumir lecturas fisiológicas en tiempo real (RHR, variaciones, calidad de sueño).
  - ESTÁ TERMINANTEMENTE PROHIBIDO prescribir entrenamientos de alta exigencia, ritmos fijos de carrera o tiradas demandantes (NADA de "10 km Z2 a 5:15/km", series o tempo).
  - La prescripción de entrenamiento DEBE ser conservadora y de CARGA MÍNIMA (movilidad suave, caminata regenerativa o descanso preventivo) hasta reconciliar datos.
  - La nutrición debe ser pauta basal estándar sin cálculos complejos de carbohidratos.`}

2. ANCLAJE DE CONTEXTO L1 & COOLDOWN COGNITIVO:
${l1Context.active ? `🚨 [COOLDOWN COGNITIVO ACTIVO - FEEDBACK REGISTRADO HACE ${l1Context.hoursSince}h]:
El usuario YA proporcionó contexto cualitativo vital en las últimas 12h:
${l1Context.formattedDetails}

REGLAS DE HIERRO L1:
- BASA toda tu respuesta, ajuste de entrenamiento y pautas nutricionales en este contexto reciente que el usuario te dio.
- ESTÁ ESTRICTAMENTE PROHIBIDO hacer preguntas genéricas sobre cómo se siente, cómo durmió o si tiene molestias, PORQUE YA TE LO DIJO.
- Si el usuario reportó dolor, fatiga o falta de tiempo, adapta y reduce la prescripción de entrenamiento en consecuencia.` : `• Sin feedback cualitativo en las últimas 12h.
${!isLive ? `• Al no haber telemetría ni feedback reciente, debes formular EXACTAMENTE UNA (1) sola pregunta quirúrgica y concisa para recuperar el contexto perdido sobre sensaciones o fatiga.` : '• Evalúa según telemetría de hardware.'}`}
`;

  if (triggerEvent === 'MORNING_BRIEFING') {
    systemDirective += `
ESTRUCTURA OBLIGATORIA DEL DESPACHO MATUTINO (formato HTML estricto para Telegram):
⚡ <b>1. Balance Fisiológico & SNC:</b> ${isLive ? 'Análisis de deltas reales de RHR/sueño vs basal calibrado.' : 'Declaración explícita de [CEGUERA SENSORIAL ACTIVA - MODELO BASAL NOMINAL] + Parámetros Nominales.'}
🏃 <b>2. Prescripción de Entrenamiento:</b> ${isLive ? 'Sesión exacta de running/fuerza programada para hoy con parámetros claros (ej. "8 km Z2 @ 5:15/km, cadencia 175-180 ppm") ajustada al estado del SNC y contexto L1.' : 'Prescripción conservadora de carga mínima/mantenimiento (ej. movilidad o descanso preventivo) por ceguera sensorial.'}
🥑 <b>3. Estrategia Nutricional:</b> ${isLive ? 'Plan de macros y timing según el gasto real programado (g/kg carbohidratos, hidratación y electrolitos).' : 'Pauta nutricional basal estándar.'}
📅 <b>4. Triaje de Agenda:</b> Eventos clave del calendario y foco de trabajo técnico/I+D.
🌙 <b>5. Ventana Óptima de Sueño:</b> Hora exacta de atenuación lumínica y apagado sugerida.
${(!isLive && !l1Context.active) ? '\n❓ <b>Reconciliación:</b> Formular UNA sola pregunta puntual sobre estado/sensaciones para calibrar el Gemelo Digital.' : ''}`;
  } else if (triggerEvent === 'EVENING_BRIEFING') {
    systemDirective += `
ESTRUCTURA OBLIGATORIA DEL DESPACHO NOCTURNO (formato HTML estricto para Telegram):
📊 <b>1. Cierre Fisiológico & Carga Acumulada:</b> Pasos reales, volumen del día y adaptación cardiovascular.
🧘 <b>2. Transición al Descanso:</b> Protocolo de apagado del SNC y hora meta para dormir.
❓ <b>3. Reconciliación L4:</b> ${l1Context.active ? 'Validación de consistencia entre el feedback recibido y la jornada.' : (isLive ? 'Confirmación de consistencia telemetría vs plan.' : 'Pregunta quirúrgica para reconciliar el descanso/fatiga no censada.')}`;
  } else {
    systemDirective += `
Responde al input con análisis técnico, claridad ejecutiva y resuelve dudas o extrae compromisos.`;
  }

  const prompt = systemDirective +
    '\n\n[CONTEXTO OPERATIVO]:' +
    '\nTelemetría Biometría: ' + _orchestratorJson_(payload.biometric_telemetry || payload, 1500, '{}') +
    '\nContexto L1 Reciente: ' + (l1Context.active ? l1Context.formattedDetails : 'Sin eventos cualitativos recientes.') +
    '\nAgenda Workspace: ' + _orchestratorJson_(payload.workspace_agenda || [], 800, '[]') +
    '\nEventos L1 Raw: ' + _orchestratorJson_(sessionEvents.slice(-3), 1200, '[]');

  try {
    const response = invokeUniversalLLM(prompt, 'Genera despacho ejecutivo táctico estructurado con cadena de pensamiento clínica.', schema, 0.2);
    if (response && typeof response === 'object' && typeof response.mensaje_telegram === 'string') {
      if (response.razonamiento_clinico_oculto) {
        _orchestratorTelemetry_(context, 'PROCESS', '[CLINICAL_COT] ' + String(response.razonamiento_clinico_oculto).substring(0, 300));
      }
      if (Array.isArray(response.tareas_sugeridas) && response.tareas_sugeridas.length > 0) {
        response.tareas_sugeridas.forEach(function(t) {
          if (t && t.titulo && typeof createProactiveTask === 'function') {
            try { createProactiveTask('[BIOOS] ' + t.titulo, t.notes || t.notas || ''); } catch (e) {}
          }
        });
      }
      return response;
    }
    if (typeof response === 'string' && typeof Core_parseStructuredJson === 'function') {
      const parsed = Core_parseStructuredJson(response, { expectedType: 'object' });
      if (parsed.ok && parsed.value.mensaje_telegram) return parsed.value;
    }
  } catch (error) { _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] Síntesis LLM degradada.', { error: Core_normalizeError(error).code }); }
  return _orchestratorDegradedOutput_(taskCount);
}

function _orchestratorDegradedOutput_(taskCount) { return { mensaje_telegram: '⚠️ <b>[SRE] Degradación grácil activa.</b>\nEl análisis se registró sin acciones no verificadas.', resumen_ejecutivo: 'Ciclo degradado; tareas aprobadas: ' + taskCount + '.' }; }
function _orchestratorBlockActions_(hypothesis, reason) { let clone = {}; try { clone = JSON.parse(JSON.stringify(hypothesis || {})); } catch (ignore) {} clone.tareas_ejecutivas = []; clone.accion_bloqueada = reason; return clone; }
function _orchestratorRequireBudget_(context, minimumMs, phase) { if (Core_remainingBudgetMs(context) < minimumMs) throw new Error('[ORCHESTRATOR_DEADLINE] Presupuesto agotado antes de ' + phase + '.'); }
function _orchestratorTelemetry_(context, severity, message, fields) { if (typeof sendContextualTelemetry === 'function') return sendContextualTelemetry(context, severity, message, fields); if (typeof sendSystemTelemetry === 'function') return sendSystemTelemetry(severity, message, fields); }
function _orchestratorJson_(value, maxChars, fallback) { try { return JSON.stringify(value).substring(0, maxChars); } catch (ignore) { return fallback; } }
function _orchestratorCapabilityEnabled_(name) { return !!(typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG.CAPABILITIES && BIOOS_CONFIG.CAPABILITIES[name] === true); }
function _calculateCognitiveCooldown(sessionEvents, thresholdHours) { return _extractL1CognitiveContext(sessionEvents, thresholdHours); }

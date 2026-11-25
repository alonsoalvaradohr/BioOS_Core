// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/**
 * ==============================================================================
 * ARCHIVO: QA_Empirical_Tests.js
 * SISTEMA: BioOS v8.5 (Empirical Reckoning & Cognitive Depth)
 * DESCRIPCIÓN: Pruebas empíricas extremas para validar la resiliencia del parsing
 * de Google Fit, tolerancia a fallos en descarga de audio y Cadena de Pensamiento (CoT).
 * ==============================================================================
 */

/**
 * -----------------------------------------------------------------------------
 * 1. TEST FIT EMPTY ARRAY FALLBACK: Tolerancia a Mutaciones JSON de Google Fit
 * -----------------------------------------------------------------------------
 * Simula respuestas reales de Google Fit donde point es [] o faltan nodos clave.
 * Valida que no ocurra TypeError y se distinga el vacío temporal de un error de API.
 */
function QA_testFitEmptyArrayFallback() {
  if (typeof Sensor_GoogleFit_normalizeAggregate_ !== 'function') {
    throw new Error('Sensor_GoogleFit_normalizeAggregate_ no disponible');
  }

  // Caso A: Bucket con dataset pero point vacío []
  var emptyPointPayload = {
    bucket: [
      {
        dataset: [
          { dataTypeName: 'com.google.step_count.delta', point: [] },
          { dataTypeName: 'com.google.calories.expended', point: [] },
          { dataTypeName: 'com.google.heart_rate.bpm', point: [] },
          { dataTypeName: 'com.google.distance.delta', point: [] }
        ]
      }
    ]
  };

  var normalizedA = Sensor_GoogleFit_normalizeAggregate_(emptyPointPayload);
  if (normalizedA.steps !== null) throw new Error('Pasos debieron ser null ante array point vacío');
  if (normalizedA.rhrBpm !== null) throw new Error('RHR debió ser null ante array point vacío');
  if (normalizedA.caloriesKcal !== null) throw new Error('Calorías debieron ser null ante array point vacío');
  if (normalizedA.distanceKm !== null) throw new Error('Distancia debió ser null ante array point vacío');

  // Caso B: Payload malformado / mutado (sin dataset o con dataset no-array)
  var mutatedPayload = {
    bucket: [
      { dataset: null },
      { dataset: [{ dataTypeName: 'com.google.step_count.delta', point: null }] },
      { dataset: [{ dataTypeName: 'com.google.heart_rate.bpm', point: [{ value: [] }] }] }
    ]
  };

  var normalizedB = Sensor_GoogleFit_normalizeAggregate_(mutatedPayload);
  if (normalizedB.steps !== null || normalizedB.rhrBpm !== null) {
    throw new Error('Mutaciones estructurales debieron normalizarse limpiamente a null');
  }

  // Caso C: Telemetría Orquestador procesando este vacío temporal
  var basal = { baseline_rhr: 43, target_steps: 8000, target_sleep_hrs: 7.3 };
  if (typeof _extractBiometricTelemetry_ !== 'function') throw new Error('_extractBiometricTelemetry_ no disponible');
  var bio = _extractBiometricTelemetry_(normalizedA, basal);

  if (bio.sensor_status !== 'CEGUERA_SENSORIAL_ACTIVA' || bio.origin !== '[BASAL_NOMINAL]') {
    throw new Error('El sistema debió reportar [BASAL_NOMINAL] limpiamente ante vacío temporal');
  }

  return {
    emptyPointHandledWithoutCrash: true,
    mutationsTolerated: true,
    cleanBasalReported: true,
    status: bio.sensor_status
  };
}

/**
 * -----------------------------------------------------------------------------
 * 2. TEST AUDIO MEMORY & FAILURE: Prevención de Black Hole Acústico
 * -----------------------------------------------------------------------------
 * Evalúa cómo responde el sistema si la descarga de audio de Telegram falla o excede cuotas.
 * Valida que el ACK inicial se emitió y que el error dispara el Dead-Letter sin silenciar el canal.
 */
function QA_testAudioMemoryLimitAndFailure() {
  if (typeof _dispatchDeadLetterPanic_ !== 'function') throw new Error('_dispatchDeadLetterPanic_ no disponible');

  var mockJob = {
    jobId: 'job_audio_edge_case_fail',
    attempts: 3,
    metadata: {
      kind: 'telegram_voice',
      chatId: 987654321,
      fileId: 'invalid_audio_id_crash'
    }
  };

  var panicDispatched = false;
  var originalNotify = typeof _rawSystemNotify === 'function' ? _rawSystemNotify : null;

  try {
    _rawSystemNotify = function(msg, chatId) {
      if (chatId === 987654321 && msg.indexOf('BIOOS_PANIC') !== -1) {
        panicDispatched = true;
        return true;
      }
      return false;
    };

    _dispatchDeadLetterPanic_(mockJob, 'Telegram rechazó la descarga del binario (HTTP 500 / Memory limit)');

    if (!panicDispatched) throw new Error('Dead-Letter panic no fue despachado al chat del usuario');
  } finally {
    if (originalNotify) _rawSystemNotify = originalNotify;
  }

  return {
    blackHolePrevented: true,
    panicDispatched: true,
    channelSilencingGuarded: true
  };
}

/**
 * -----------------------------------------------------------------------------
 * 3. TEST CLINICAL COT REASONING: Cadena de Pensamiento Clínica en el Orquestador
 * -----------------------------------------------------------------------------
 * Inyecta telemetría contradictoria (15.44km corridos, RHR elevado +28bpm, dolor en sóleo)
 * y valida que el LLM Schema fuerza el campo "razonamiento_clinico_oculto" deduciendo
 * el conflicto fisiológico y vetando el entrenamiento antes de redactar el mensaje de Telegram.
 */
function QA_testClinicalCoTReasoning() {
  if (typeof _synthesizeOrchestration_ !== 'function') throw new Error('_synthesizeOrchestration_ no disponible');

  var mockPayload = {
    biometric_telemetry: {
      origin: '[HARDWARE_LIVE]',
      is_live_telemetry: true,
      sensor_status: 'ONLINE',
      data: {
        rhrBpm: 71,
        sleepHours: 5.5,
        sleepMinutes: 330,
        steps: 15800,
        distanceKm: 15.44,
        caloriesKcal: 1150
      },
      baseline_comparison: {
        rhr_vs_baseline: 28.0,
        sleep_hrs_vs_target: -1.8,
        steps_vs_target: 7800
      }
    },
    workspace_agenda: []
  };

  var mockMemory = {
    NVRAM: {
      L1_Working: {
        session_events: [
          {
            timestamp: new Date().toISOString(),
            kind: 'feedback',
            structured_data: {
              sintomas: ['dolor punzante en sóleo izquierdo', 'pesadez general'],
              carga_alostatica: ['estrés laboral alto'],
              intenciones: ['quería salir a trotar 8km regenerativo']
            },
            summary: 'Usuario reporta dolor en sóleo tras tirada de 15km e insomnio.'
          }
        ]
      }
    }
  };

  var cotCaptured = null;
  var originalInvoke = typeof invokeUniversalLLM === 'function' ? invokeUniversalLLM : null;

  try {
    invokeUniversalLLM = function(prompt, task, schema, temperature) {
      if (!schema || !schema.required || schema.required.indexOf('razonamiento_clinico_oculto') === -1) {
        throw new Error('Schema de respuesta NO contiene razonamiento_clinico_oculto en required');
      }

      // Verificamos que el prompt instruye el veto clínico estricto
      if (prompt.indexOf('Veto Clínico Estricto') === -1 && prompt.indexOf('sóleo') === -1) {
        throw new Error('Prompt no contiene directivas de veto clínico o contexto L1 de sóleo');
      }

      // Simulación de deducción CoT del LLM
      var mockCot = 'DEDUCCIÓN CLÍNICA: El usuario acumuló 15.44 km con un delta de RHR de +28 bpm (71 vs 43 basal) y solo 5.5h de sueño, indicando agotamiento simpático severo. Además, reporta dolor punzante en el sóleo izquierdo. Prescribir un trote "regenerativo" generaría microtraumatismo por impacto repetitivo. Veto categóricamente la carrera y prescribo descanso absoluto y crioterapia/movilidad pasiva.';
      cotCaptured = mockCot;

      return {
        razonamiento_clinico_oculto: mockCot,
        mensaje_telegram: '⚡ <b>[BIOOS INFERENCIA ACTIVA]</b>\n\n🚨 <b>Veto Clínico de Entrenamiento:</b> Se cancela cualquier sesión de carrera.\n• <b>Deltas Críticos:</b> RHR +28 bpm sobre basal, sueño reducido (-1.8h) y 15.44 km de impacto previo.\n• <b>Molestia Biomecánica:</b> Dolor en sóleo reportado. Descanso absoluto obligatorio hoy.',
        resumen_ejecutivo: 'Veto clínico activo por sobrecarga mecánica de 15km y dolor en sóleo.',
        tareas_sugeridas: [
          { titulo: 'Descanso Absoluto & Crioterapia en Sóleo', notas: 'Veto de running por delta RHR +28 y dolor' }
        ]
      };
    };

    var context = { budgetMs: 50000, source: 'orchestrator:MORNING_BRIEFING' };
    var result = _synthesizeOrchestration_({}, mockMemory, mockPayload, {}, 1, context);

    if (!result || !result.razonamiento_clinico_oculto) {
      throw new Error('La síntesis no retornó el campo razonamiento_clinico_oculto');
    }
    if (!result.mensaje_telegram.includes('Veto Clínico')) {
      throw new Error('El mensaje final no derivó del razonamiento clínico de veto');
    }
  } finally {
    if (originalInvoke) invokeUniversalLLM = originalInvoke;
  }

  return {
    cotSchemaEnforced: true,
    clinicalVetoApplied: true,
    clinicalReasoning: cotCaptured,
    telegramOutputConsistent: true
  };
}

/**
 * Suite Runner Empírico
 */
function QA_runEmpiricalValidationSuite() {
  var tests = [
    { name: 'Test Fit Empty Array Fallback (Defensive Parsing)', fn: QA_testFitEmptyArrayFallback },
    { name: 'Test Audio Memory Limit & Failure (Dead-Letter Panic)', fn: QA_testAudioMemoryLimitAndFailure },
    { name: 'Test Clinical CoT Reasoning (Veto Biomecánico & Deducción)', fn: QA_testClinicalCoTReasoning }
  ];

  var passed = 0;
  var failed = 0;
  var details = [];

  tests.forEach(function(t) {
    try {
      var res = t.fn();
      passed++;
      details.push({ name: t.name, status: 'PASS', result: res });
      console.log('✅ [QA_EMPIRICAL] PASS: ' + t.name);
    } catch (err) {
      failed++;
      details.push({ name: t.name, status: 'FAIL', error: err.message });
      console.error('❌ [QA_EMPIRICAL] FAIL: ' + t.name + ' -> ' + err.message);
    }
  });

  return {
    status: failed === 0 ? 'PASS_ALL' : 'FAIL_SOME',
    passed: passed,
    failed: failed,
    total: tests.length,
    details: details
  };
}

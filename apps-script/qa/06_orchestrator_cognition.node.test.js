// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/* Node-only contract test for Orchestrator Cognition, Telemetry and Anti-Hallucination. */
if (typeof require !== 'undefined') {
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(ok, message) { if (!ok) throw new Error(message); }
function run(name, fn) { try { fn(); console.log('PASS ' + name); return true; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); return false; } }

let pass = 0, fail = 0;
function test(name, fn) { if (run(name, fn)) pass++; else fail++; }

const orchestratorSrc = fs.readFileSync(path.join(__dirname, '..', '06_Agent_Orchestrator.js'), 'utf8');
const compilerSrc = fs.readFileSync(path.join(__dirname, '..', '05_Bio_Compiler.js'), 'utf8');

let mockLLMPrompt = null;
let mockLLMPayload = null;

const context = {
  console,
  BIOOS_CONFIG: {
    CAPABILITIES: { WORKSPACE_CONTEXT: false, EXTERNAL_TASKS: false },
    BIOMETRY: { BASELINE_RHR: 43, TARGET_STEPS: 8000, TARGET_SLEEP_HRS: 7.3 }
  },
  executeWithResilience: (_name, fn) => fn(),
  Core_remainingBudgetMs: () => 10000,
  Core_normalizeError: (e) => ({ code: e && e.message || 'ERR' }),
  sendSystemTelemetry: () => {},
  sendContextualTelemetry: () => {},
  recordProvenance: (data, src, inferred) => ({ ...data, _prov: src }),
  invokeUniversalLLM: (prompt, payload, schema, temp) => {
    mockLLMPrompt = prompt;
    mockLLMPayload = payload;
    return {
      mensaje_telegram: '⚡ <b>1. Balance:</b> OK',
      resumen_ejecutivo: 'Síntesis test.',
      tokens_fisiologicos: ['RHR_43', 'SLEEP_7.3'],
      nivel_ruido_estimado: 'BAJO',
      vector_carga_snc: 0.1,
      alerta_ceguera_sensorial: false
    };
  }
};

vm.createContext(context);
vm.runInContext(orchestratorSrc, context);
vm.runInContext(compilerSrc, context);

test('extractBiometricTelemetry accurately extracts live metrics from raw payload', () => {
  const basal = { baseline_rhr: 43, target_steps: 8000, target_sleep_hrs: 7.3 };
  const rawPayload = { testRhr: 45, testSleepMinutes: 440, testSteps: 1250 };
  const telemetry = context._extractBiometricTelemetry_(rawPayload, basal);

  assert(telemetry.origin === '[HARDWARE_LIVE]', 'origin must be [HARDWARE_LIVE]');
  assert(telemetry.is_live_telemetry === true, 'is_live_telemetry must be true');
  assert(telemetry.data.rhrBpm === 45, 'rhrBpm mismatch');
  assert(telemetry.data.sleepMinutes === 440, 'sleepMinutes mismatch');
  assert(telemetry.data.steps === 1250, 'steps mismatch');
  assert(telemetry.baseline_comparison.rhr_vs_baseline === 2, 'rhr_vs_baseline mismatch');
});

test('extractBiometricTelemetry converts sleep in hours to minutes correctly', () => {
  const basal = { baseline_rhr: 43, target_steps: 8000, target_sleep_hrs: 7.3 };
  const rawPayload = { rhr: 42, sleep: 7.5, steps: 8500 };
  const telemetry = context._extractBiometricTelemetry_(rawPayload, basal);

  assert(telemetry.origin === '[HARDWARE_LIVE]', 'origin must be [HARDWARE_LIVE]');
  assert(telemetry.data.sleepMinutes === 450, 'sleep hours to minutes conversion failed');
  assert(telemetry.data.sleepHours === 7.5, 'sleepHours mismatch');
  assert(telemetry.baseline_comparison.sleep_hrs_vs_target === 0.2, 'sleep delta mismatch');
});

test('extractBiometricTelemetry declares sensor blindness when metrics are completely absent', () => {
  const basal = { baseline_rhr: 43, target_steps: 8000, target_sleep_hrs: 7.3 };
  const telemetry = context._extractBiometricTelemetry_({}, basal);

  assert(telemetry.origin === '[BASAL_NOMINAL]', 'origin must be [BASAL_NOMINAL]');
  assert(telemetry.is_live_telemetry === false, 'is_live_telemetry must be false');
  assert(telemetry.sensor_status === 'CEGUERA_SENSORIAL_ACTIVA', 'sensor_status mismatch');
  assert(telemetry.reference_baseline.nominal_rhr_bpm === 43, 'nominal_rhr_bpm mismatch');
});

test('extractL1CognitiveContext activates cooldown and extracts qualitative context within 12h', () => {
  const now = Date.now();
  const sessionEvents = [
    {
      timestamp: new Date(now - 2 * 3600 * 1000).toISOString(),
      origin: 'USER_FEEDBACK',
      data: {
        tokens: {
          user_nlp: {
            sintomatologia_fisica: ['Molestia en tendón de Aquiles izquierdo'],
            carga_alostatica_percibida: ['Estrés alto por entrega'],
            adherencia_nutricional: ['Cena ligera alta en proteína'],
            intenciones_futuras: ['Correr suave si no hay dolor']
          }
        },
        sintesis: 'Usuario reportó molestia en tendón.'
      }
    }
  ];

  const l1Context = context._extractL1CognitiveContext(sessionEvents, 12);
  assert(l1Context.active === true, 'cooldown must be active');
  assert(l1Context.hoursSince >= 1.9 && l1Context.hoursSince <= 2.1, 'hoursSince mismatch');
  assert(l1Context.details.sintomas.includes('Molestia en tendón de Aquiles izquierdo'), 'sintomas missing');
  assert(l1Context.details.carga_alostatica.includes('Estrés alto por entrega'), 'carga alostatica missing');
  assert(l1Context.formattedDetails.toLowerCase().includes('tendón de aquiles'), 'formattedDetails missing symptom text');
});

test('extractL1CognitiveContext stays inactive when feedback is older than 12h', () => {
  const now = Date.now();
  const sessionEvents = [
    {
      timestamp: new Date(now - 14 * 3600 * 1000).toISOString(),
      origin: 'USER_FEEDBACK',
      data: { user_nlp: { sintomatologia_fisica: ['Dolor rodilla'] } }
    }
  ];

  const l1Context = context._extractL1CognitiveContext(sessionEvents, 12);
  assert(l1Context.active === false, 'cooldown must be inactive for >12h');
  assert(l1Context.hoursSince === null, 'hoursSince must be null');
});

test('synthesizeOrchestration enforces anti-hallucination guardrails under Ceguera Sensorial', () => {
  const rom = { agent_prompts: {} };
  const memory = {
    NVRAM: {
      L1_Working: { session_events: [] },
      L4_Basal: { baseline_rhr: 43, target_steps: 8000, target_sleep_hrs: 7.3 }
    }
  };
  const payload = {
    biometric_telemetry: {
      origin: '[BASAL_NOMINAL]',
      is_live_telemetry: false,
      sensor_status: 'CEGUERA_SENSORIAL_ACTIVA',
      reference_baseline: { nominal_rhr_bpm: 43, nominal_sleep_hrs: 7.3, nominal_target_steps: 8000 }
    }
  };
  const reqContext = { requestId: 'req-test', eventId: 'ev-test', source: 'orchestrator:MORNING_BRIEFING' };

  context._synthesizeOrchestration_(rom, memory, payload, {}, 0, reqContext);

  assert(mockLLMPrompt !== null, 'LLM was not invoked');
  assert(mockLLMPrompt.includes('[CEGUERA SENSORIAL ACTIVA - MODELO BASAL NOMINAL]'), 'prompt missing ceguera sensorial declaration');
  assert(mockLLMPrompt.includes('ESTÁ TERMINANTEMENTE PROHIBIDO prescribir entrenamientos de alta exigencia'), 'prompt missing high-performance workout veto');
  assert(mockLLMPrompt.includes('CARGA MÍNIMA'), 'prompt missing minimum load prescription requirement');
  assert(mockLLMPrompt.includes('UNA sola pregunta puntual'), 'prompt missing single question requirement under sensor blindness without feedback');
});

test('compileBiometricTelemetry preserves real numerical metrics', () => {
  const compiled = context.compileBiometricTelemetry(44, 7.2, 8500);
  assert(compiled.raw_metrics.rhr === 44, 'rhr not preserved');
  assert(compiled.raw_metrics.sleep === 7.2, 'sleep not preserved');
  assert(compiled.raw_metrics.steps === 8500, 'steps not preserved');
  assert(compiled.alerta_ceguera_sensorial === false, 'false positive ceguera sensorial');
});

console.log('Orchestrator Cognition Node QA: PASS ' + pass + ' | FAIL ' + fail);
if (fail) process.exitCode = 1;
}

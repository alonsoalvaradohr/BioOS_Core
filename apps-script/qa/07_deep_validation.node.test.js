/* Node-only runner for QA12 Deep Validation Extreme Edge Cases. */
if (typeof require !== 'undefined') {
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(ok, message) { if (!ok) throw new Error(message); }
function run(name, fn) { try { fn(); console.log('PASS ' + name); return true; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); return false; } }

let pass = 0, fail = 0;
function test(name, fn) { if (run(name, fn)) pass++; else fail++; }

const telemetrySrc = fs.readFileSync(path.join(__dirname, '..', '01_Sys_Telemetry.js'), 'utf8');
const repoSrc = fs.readFileSync(path.join(__dirname, '..', '02b_DB_Repository.js'), 'utf8');
const webhookSrc = fs.readFileSync(path.join(__dirname, '..', '03b_Net_Webhook.js'), 'utf8');
const compilerSrc = fs.readFileSync(path.join(__dirname, '..', '05_Bio_Compiler.js'), 'utf8');
const orchestratorSrc = fs.readFileSync(path.join(__dirname, '..', '06_Agent_Orchestrator.js'), 'utf8');
const deepDebugSrc = fs.readFileSync(path.join(__dirname, '..', '09_SRE_DeepDebug.js'), 'utf8');
const qa12Src = fs.readFileSync(path.join(__dirname, '..', 'QA12_Deep_Validation.js'), 'utf8');

let mockLLMPayload = null;
let mockLLMPrompt = null;
let simulatedEvents = [];
const mockCache7 = new Map();

const context = {
  console,
  Date,
  Math,
  String,
  Number,
  Array,
  Object,
  JSON,
  RegExp,
  isFinite,
  isNaN,
  BIOOS_CONFIG: {
    VERSION: '5.4.0',
    CAPABILITIES: { WORKSPACE_CONTEXT: false, EXTERNAL_TASKS: false },
    BIOMETRY: { BASELINE_RHR: 43, TARGET_STEPS: 8000, TARGET_SLEEP_HRS: 7.3 },
    RESILIENCE: { MAX_RETRIES: 3, BACKOFF_BASE_MS: 100, CIRCUIT_BREAKER_TRIP: 5 },
    SYS_FLAGS: { DEBUG_MODE: true, ENABLE_AUTO_REPAIR: true }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null,
      setProperty: () => {},
      deleteProperty: () => {}
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => mockCache7.get(k) || null,
      put: (k, v) => mockCache7.set(k, String(v)),
      remove: (k) => mockCache7.delete(k)
    })
  },
  Utilities: {
    sleep: () => {},
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    getUuid: () => 'uuid-qa12'
  },
  executeWithResilience: (_name, fn) => fn(),
  executeWithMutex: (_type, fn) => fn(),
  Core_remainingBudgetMs: () => 10000,
  Core_normalizeError: (e) => ({ code: e && e.message || 'ERR' }),
  sendSystemTelemetry: () => {},
  sendContextualTelemetry: () => {},
  recordProvenance: (data, src, inferred) => ({ ...data, _prov: src }),
  getSystemMemory: () => ({
    ROM: { agent_prompts: {} },
    NVRAM: {
      L1_Working: { session_events: simulatedEvents },
      L4_Basal: { baseline_rhr: 43, target_steps: 8000, target_sleep_hrs: 7.3 }
    }
  }),
  ingestWorkingMemory: (origin, tokens) => {
    simulatedEvents.push({ timestamp: new Date().toISOString(), origin: origin, data: tokens });
    return false;
  },
  invokeUniversalLLM: (prompt, payload, schema, temp) => {
    mockLLMPrompt = prompt;
    mockLLMPayload = payload;

    // Si es compilador multimodal (sintomatologia, carga, adherencia, intenciones)
    if (schema && schema.properties && schema.properties.sintomatologia_fisica) {
      const isContradictory = Array.isArray(payload) && payload.some(p => p.text && p.text.includes('fatiga muscular'));
      return {
        sintomatologia_fisica: isContradictory ? ['Fatiga muscular severa en isquiotibiales'] : ['Sin molestias'],
        carga_alostatica_percibida: ['Estrés moderado'],
        adherencia_nutricional: ['Ensalada y pollo'],
        intenciones_futuras: ['Descanso total']
      };
    }

    // Default orchestrator output
    return {
      mensaje_telegram: '⚡ <b>1. Balance Fisiológico:</b> Procesado.\n🏃 <b>2. Prescripción:</b> Adaptada.',
      resumen_ejecutivo: 'Síntesis validada con éxito.',
      tareas_sugeridas: []
    };
  }
};

vm.createContext(context);
vm.runInContext(telemetrySrc, context);
vm.runInContext(repoSrc, context);
vm.runInContext(webhookSrc, context);
vm.runInContext(compilerSrc, context);
vm.runInContext(orchestratorSrc, context);
vm.runInContext(deepDebugSrc, context);
vm.runInContext(qa12Src, context);

test('QA12 TEST 1: Multimodalidad Extrema procesa audio, foto y texto contradictorio sin error', () => {
  const res = context.QA12_testMultimodalExtrema();
  assert(res && res.multimodalPartsProcessed === true, 'Multimodal parts failed');
  assert(res.sintomasExtraidos >= 1, 'Sintomas not extracted from multimodal payload');
  assert(Array.isArray(mockLLMPayload), 'Gemini did not receive array of multimodal parts');
  assert(mockLLMPayload.some(p => p.inlineData && p.inlineData.mimeType === 'image/jpeg'), 'Image part missing in Gemini request');
  assert(mockLLMPayload.some(p => p.inlineData && p.inlineData.mimeType === 'audio/ogg'), 'Voice part missing in Gemini request');
});

test('QA12 TEST 2: Memoria Longitudinal ancla contexto L1 y retiene feedback de turno previo', () => {
  const res = context.QA12_testMemoriaLongitudinal();
  assert(res && res.cooldownActivo === true, 'L1 cooldown should be active');
  assert(res.horasTranscurridas <= 1.0, 'Hours since feedback should be <= 1.0h');
  assert(res.contextoAnclado.toLowerCase().includes('pizza'), 'Pizza context was forgotten');
  assert(res.contextoAnclado.toLowerCase().includes('sóleo') || res.contextoAnclado.toLowerCase().includes('soleo'), 'Soleo symptom was forgotten');
});

test('QA12 TEST 3: Inanición Sensorial bloquea rutinas de alto rendimiento y activa ceguera sensorial', () => {
  const res = context.QA12_testInanicionSensorial();
  assert(res && res.origen === '[BASAL_NOMINAL]', 'Origin must be [BASAL_NOMINAL]');
  assert(res.sensorStatus === 'CEGUERA_SENSORIAL_ACTIVA', 'Sensor status must be CEGUERA_SENSORIAL_ACTIVA');
  assert(res.alucinacionBloqueada === true, 'Anti-hallucination shield should be active');
});

test('QA12 TEST 4: Resiliencia de Infraestructura detecta HTTP 503 como determinista sin bucles SRE', () => {
  const res = context.QA12_testResilienciaInfraestructura();
  assert(res && res.infraErrorCaptured === true, 'Infrastructure 503 was not captured');
  assert(res.infiniteLoopPrevented === true, 'Infinite loop was not prevented');
  assert(res.classification === 'DETERMINISTIC_EXTERNAL_INFRA_503', 'Error classification mismatch');
});

test('QA12 Suite Runner ejecuta las 7 pruebas de estrés con estatus PASS_ALL', () => {
  const report = context.QA12_runDeepValidationSuite();
  assert(report.status === 'PASS_ALL', 'QA12 suite did not pass all tests');
  assert(report.passed === 7, `Expected 7 passed tests, got ${report.passed}`);
  assert(report.failed === 0, `Expected 0 failed tests, got ${report.failed}`);
});

console.log('QA12 Deep Validation Node QA: PASS ' + pass + ' | FAIL ' + fail);
if (fail) process.exitCode = 1;
}

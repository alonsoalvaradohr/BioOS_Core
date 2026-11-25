// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/* Node-only QA runner for QA_Production_Suite.js. */
if (typeof require !== 'undefined') {
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(ok, message) { if (!ok) throw new Error(message); }
function run(name, fn) { try { fn(); console.log('PASS ' + name); return true; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); return false; } }

let pass = 0, fail = 0;
function test(name, fn) { if (run(name, fn)) pass++; else fail++; }

const configSrc = fs.readFileSync(path.join(__dirname, '..', '00_Sys_Config.js'), 'utf8');
const telemetrySrc = fs.readFileSync(path.join(__dirname, '..', '01_Sys_Telemetry.js'), 'utf8');
const sensorContractsSrc = fs.readFileSync(path.join(__dirname, '..', 'sensors', '00_Sensor_Contracts.js'), 'utf8');
const sensorFitSrc = fs.readFileSync(path.join(__dirname, '..', 'sensors', '02_GoogleFit_Provider.js'), 'utf8');
const sensorEngineSrc = fs.readFileSync(path.join(__dirname, '..', '04_Sensor_Engine.js'), 'utf8');
const repoSrc = fs.readFileSync(path.join(__dirname, '..', '02b_DB_Repository.js'), 'utf8');
const webhookSrc = fs.readFileSync(path.join(__dirname, '..', '03b_Net_Webhook.js'), 'utf8');
const compilerSrc = fs.readFileSync(path.join(__dirname, '..', '05_Bio_Compiler.js'), 'utf8');
const orchestratorSrc = fs.readFileSync(path.join(__dirname, '..', '06_Agent_Orchestrator.js'), 'utf8');
const daemonsSrc = fs.readFileSync(path.join(__dirname, '..', '11_Net_Daemons.js'), 'utf8');
const prodQaSrc = fs.readFileSync(path.join(__dirname, '..', 'QA_Production_Suite.js'), 'utf8');

const mockCache9 = new Map();
let lastNotifyMessage = null;
let lastNotifyChatId = null;

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
    VERSION: '5.5.0',
    CAPABILITIES: { WORKSPACE_CONTEXT: false, EXTERNAL_TASKS: false, VOICE_INPUT: true },
    BIOMETRY: { BASELINE_RHR: 43, TARGET_STEPS: 8000, TARGET_SLEEP_HRS: 7.3 },
    RESILIENCE: { MAX_RETRIES: 3, BACKOFF_BASE_MS: 100, CIRCUIT_BREAKER_TRIP: 5 },
    SYS_FLAGS: { DEBUG_MODE: true, ENABLE_AUTO_REPAIR: true }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => 'mock-token',
      setProperty: () => {},
      deleteProperty: () => {}
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => mockCache9.get(k) || null,
      put: (k, v) => mockCache9.set(k, String(v)),
      remove: (k) => mockCache9.delete(k)
    })
  },
  Utilities: {
    sleep: () => {},
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    getUuid: () => 'uuid-prod-qa'
  },
  UrlFetchApp: {
    fetch: (url, opts) => {
      if (url.includes('/sendMessage')) {
        const payload = JSON.parse(opts.payload);
        lastNotifyMessage = payload.text;
        lastNotifyChatId = payload.chat_id;
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ ok: true, result: { message_id: 101 } })
        };
      }
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    }
  },
  ContentService: {
    createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
    MimeType: { JSON: 'json' }
  },
  ScriptApp: {
    getProjectTriggers: () => [],
    deleteTrigger: () => {},
    newTrigger: () => ({
      timeBased: () => ({
        after: () => ({
          create: () => ({})
        })
      })
    })
  },
  DriveApp: {
    getFileById: (id) => {
      throw new Error('Exception: No item with the given ID could be found, or you do not have permission to access it.');
    }
  },
  SpreadsheetApp: {
    openById: () => ({
      getSheetByName: () => ({
        getLastRow: () => 1,
        getLastColumn: () => 10,
        getRange: () => ({
          getValues: () => [['job_id', 'status', 'created_at', 'lease_until', 'attempts', 'payload', 'error', 'metadata', 'updated_at', 'idempotency_key']],
          setValues: () => {}
        }),
        appendRow: () => {},
        clearContents: () => {},
        insertRows: () => {},
        deleteRow: () => {},
        setFrozenRows: () => {}
      })
    })
  },
  LockService: {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  },
  executeWithResilience: (_name, fn) => fn(),
  executeWithMutex: (_type, fn) => fn(),
  Core_remainingBudgetMs: () => 10000,
  Core_normalizeError: (e) => ({ code: (e && e.message) || 'ERR' }),
  sendSystemTelemetry: () => {},
  sendContextualTelemetry: () => {},
  recordProvenance: (data, src, inferred) => ({ ...data, _prov: src })
};

vm.createContext(context);
vm.runInContext(telemetrySrc, context);
vm.runInContext(sensorContractsSrc, context);
vm.runInContext(sensorFitSrc, context);
vm.runInContext(sensorEngineSrc, context);
vm.runInContext(repoSrc, context);
vm.runInContext(webhookSrc, context);
vm.runInContext(compilerSrc, context);
vm.runInContext(orchestratorSrc, context);
vm.runInContext(daemonsSrc, context);
vm.runInContext(prodQaSrc, context);

test('PROD QA TEST 1: Egress Hostil sanitiza caracteres reservados y preserva negrita', () => {
  const res = context.QA_testEgressHostilTelegramHTML();
  assert(res.unclosedTagsProtected === true, 'Unclosed tags failed');
  assert(res.codeBlockOperatorsEscaped === true, 'Code block operators failed');
  assert(res.hostileStringSanitized.includes('<b>Test</b>'), 'Rich format <b> was lost');
  assert(res.hostileStringSanitized.includes('&lt; 40'), 'Operator < was not sanitized');
  assert(res.hostileStringSanitized.includes('&gt; 10h'), 'Operator > was not sanitized');
  assert(res.hostileStringSanitized.includes('&amp; descanso'), 'Operator & was not sanitized');
});

test('PROD QA TEST 2: Ingesta Multimodal extrae máxima resolución de array PhotoSize sin TypeErrors', () => {
  const res = context.QA_testIngestaMultimodalVisualAudio();
  assert(res.selectedFileId === 'photo_hq_1920x1080', 'Did not select highest resolution');
  assert(res.typeErrorsPrevented === true, 'TypeErrors occurred on malformed input');
});

test('PROD QA TEST 3: VFS Drive tolera inconsistencia eventual y recupera payload masivo', () => {
  const res = context.QA_testToleranciaConsistenciaEventualDriveVFS();
  assert(res.raceConditionTolerated === true, 'Race condition failed');
  assert(res.payloadIntegrityConfirmed === true, 'Payload corrupted');
});

test('PROD QA TEST 4: Inferencia Activa L1 ancla contexto cualitativo y suprime preguntas redundantes', () => {
  const res = context.QA_testInferenciaActivaExocortexProactivo();
  assert(res.cooldownActivo === true, 'Cooldown L1 not active');
  assert(res.cegueraSensorialDeclarada === 'CEGUERA_SENSORIAL_ACTIVA', 'Blindness not declared');
  assert(res.proactiveContextRetained === true, 'Proactive context lost');
});

test('PROD QA TEST 5: Dead-Letter Protocol emite alerta de pánico y previene descartes silenciosos', () => {
  const res = context.QA_testDeadLetterProtocolZeroSilentDrops();
  assert(res.deadLetterTriggered === true, 'Dead letter not triggered');
  assert(res.silentDropPrevented === true, 'Silent drop not prevented');
  assert(lastNotifyMessage && lastNotifyMessage.includes('BIOOS_PANIC'), 'Panic alert missing in telegram notification');
});

test('PROD QA TEST 6: Dashboard Ejecutivo (/estado y /memoria) extrae telemetría y cooldown en vivo', () => {
  const dashboard = context._generateExecutiveStatusDashboard_();
  assert(typeof dashboard === 'string', 'Dashboard must be a string');
  assert(dashboard.includes('BIOOS EXOCORTEX DASHBOARD'), 'Header missing in dashboard');
  assert(dashboard.includes('Telemetría de Hardware'), 'Hardware telemetry missing');
  assert(dashboard.includes('Modo Cognitivo & Cooldown'), 'Cognitive mode missing');
  assert(dashboard.includes('Memoria L1 Reciente'), 'L1 Memory missing');
});

test('PROD QA TEST 7: Multi-Failure Edge Case tolera hardware offline, texto basura y fallo VFS simultáneo', () => {
  const res = context.QA_testMultiFailureEdgeCaseReal();
  assert(res.hardwareOfflineTolerated === true, 'Hardware offline failed');
  assert(res.garbageTextSanitized === true, 'Garbage text failed');
  assert(res.vfsPermanentFailureBounded === true, 'VFS failure unbounded');
});

test('PROD QA TEST 8: SRE Simulación de Audio en Vivo procesa webhook voice update', () => {
  const res = context.SRE_SimulateLiveAudio();
  assert(res.simulatedVoiceIngress === true, 'Voice ingress failed');
  assert(res.webhookExecuted === true, 'Webhook execution failed');
});

test('PROD QA TEST 9: Degradación Grácil Google Fit (Aislamiento 403 en Distancia)', () => {
  const res = context.QA_testGracefulDegradationGoogleFitPartialForbidden403();
  assert(res.gracefulDegradationActive === true, 'Graceful degradation inactive');
  assert(res.vitalMetricsPreserved.steps === 13332, 'Steps metric lost');
  assert(res.vitalMetricsPreserved.rhr === 75, 'RHR metric lost');
  assert(res.vitalMetricsPreserved.calories === 907, 'Calories metric lost');
  assert(res.sensorStatus === 'ONLINE', 'Sensor status must remain ONLINE');
});

test('PROD QA Suite Runner ejecuta todos los 8 tests de producción con estatus PASS_ALL', () => {
  const report = context.QA_runProductionValidationSuite();
  assert(report.status === 'PASS_ALL', 'Production QA suite did not pass all tests');
  assert(report.passed === 8, `Expected 8 passed tests, got ${report.passed}`);
  assert(report.failed === 0, `Expected 0 failed tests, got ${report.failed}`);
});

console.log('Production Suite Node QA: PASS ' + pass + ' | FAIL ' + fail);
if (fail) process.exitCode = 1;
}

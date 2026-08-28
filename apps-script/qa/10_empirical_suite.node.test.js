/* Node-only QA runner for QA_Empirical_Tests.js. */
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
const specialistsSrc = fs.readFileSync(path.join(__dirname, '..', '07_Agent_Specialists.js'), 'utf8');
const daemonsSrc = fs.readFileSync(path.join(__dirname, '..', '11_Net_Daemons.js'), 'utf8');
const empiricalQaSrc = fs.readFileSync(path.join(__dirname, '..', 'QA_Empirical_Tests.js'), 'utf8');

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
  parseInt,
  parseFloat,
  encodeURIComponent,
  decodeURIComponent,
  Utilities: {
    base64Encode: function(bytes) { return Buffer.from(bytes).toString('base64'); },
    base64Decode: function(str) { return Buffer.from(str, 'base64'); },
    newBlob: function(data, mime, name) {
      return {
        getBytes: function() { return Buffer.isBuffer(data) ? data : Buffer.from(data); },
        getContentType: function() { return mime || 'application/octet-stream'; },
        getName: function() { return name || 'blob'; }
      };
    }
  },
  ScriptApp: {
    getOAuthToken: function() { return 'ya29.mock_token_empirical'; },
    getProjectTriggers: function() { return []; },
    newTrigger: function() {
      return {
        timeBased: function() {
          return {
            after: function() {
              return { create: function() { return {}; } };
            }
          };
        }
      };
    }
  },
  PropertiesService: {
    getScriptProperties: function() {
      return {
        getProperty: function(k) {
          if (k === 'TELEGRAM_BOT_TOKEN') return '123456:FAKE_TOKEN';
          if (k === 'TELEGRAM_CHAT_ID') return '123456789';
          return null;
        },
        setProperty: function() {}
      };
    }
  },
  UrlFetchApp: {
    fetchAll: function(requests) {
      return requests.map(function() {
        return {
          getResponseCode: function() { return 200; },
          getContentText: function() { return JSON.stringify({ bucket: [] }); }
        };
      });
    },
    fetch: function() {
      return {
        getResponseCode: function() { return 200; },
        getContentText: function() { return JSON.stringify({ bucket: [] }); }
      };
    }
  },
  sendSystemTelemetry: function() {},
  sendContextualTelemetry: function() {},
  Core_remainingBudgetMs: function() { return 50000; },
  Core_normalizeError: function(e) { return { code: 'ERROR', message: e.message }; },
  _rawSystemNotify: function(msg, chatId) {
    lastNotifyMessage = msg;
    lastNotifyChatId = chatId;
    return true;
  }
};

vm.createContext(context);
vm.runInContext(configSrc, context);
vm.runInContext(telemetrySrc, context);
vm.runInContext(sensorContractsSrc, context);
vm.runInContext(sensorFitSrc, context);
vm.runInContext(sensorEngineSrc, context);
vm.runInContext(repoSrc, context);
vm.runInContext(webhookSrc, context);
vm.runInContext(compilerSrc, context);
vm.runInContext(specialistsSrc, context);
vm.runInContext(orchestratorSrc, context);
vm.runInContext(daemonsSrc, context);
vm.runInContext(empiricalQaSrc, context);

test('EMPIRICAL QA TEST 1: Google Fit tolera point: [] y mutaciones sin TypeErrors ni falsas alarmas', () => {
  const res = context.QA_testFitEmptyArrayFallback();
  assert(res.emptyPointHandledWithoutCrash === true, 'Empty point crashed');
  assert(res.mutationsTolerated === true, 'Mutations not tolerated');
  assert(res.cleanBasalReported === true, 'Basal not reported');
});

test('EMPIRICAL QA TEST 2: Fallo en audio dispara Dead-Letter Panic sin silenciar el canal de Telegram', () => {
  const res = context.QA_testAudioMemoryLimitAndFailure();
  assert(res.blackHolePrevented === true, 'Black hole occurred');
  assert(res.panicDispatched === true, 'Panic was not dispatched');
  assert(res.channelSilencingGuarded === true, 'Channel was silenced');
});

test('EMPIRICAL QA TEST 3: Cadena de Pensamiento Clínica (CoT) fuerza razonamiento_clinico_oculto y veto biomecánico', () => {
  const res = context.QA_testClinicalCoTReasoning();
  assert(res.cotSchemaEnforced === true, 'CoT schema was not enforced');
  assert(res.clinicalVetoApplied === true, 'Clinical veto was not applied');
  assert(res.clinicalReasoning.includes('Veto'), 'Clinical reasoning lacked veto deduction');
  assert(res.telegramOutputConsistent === true, 'Telegram output was inconsistent');
});

test('EMPIRICAL QA Runner ejecuta todas las pruebas con PASS_ALL', () => {
  const suite = context.QA_runEmpiricalValidationSuite();
  assert(suite.status === 'PASS_ALL', 'Empirical suite status not PASS_ALL');
  assert(suite.passed === 3, 'Expected 3 passed tests');
  assert(suite.failed === 0, 'Expected 0 failed tests');
});

console.log('Empirical Suite Node QA: PASS ' + pass + ' | FAIL ' + fail);
if (fail) process.exitCode = 1;
}

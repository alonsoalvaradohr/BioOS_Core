/* Node-only tests for query-operation routing and evidence-backed workout photo memory. */
if (typeof require !== 'undefined') {
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

const state = { NVRAM: { L2_Episodic: { raw_data_lake: [] } } };
let requestedScopes = null, authStatus = 'REQUIRED', notifiedMessage = '';
const utilities = { formatDate: (date, _tz, pattern) => {
  const local = new Date(date.getTime() - 6 * 60 * 60 * 1000).toISOString();
  return pattern === 'yyyy-MM-dd' ? local.slice(0, 10) : local.slice(11, 16);
} };
const context = {
  Date, Math, String, Number, Array, Object, JSON, RegExp, isFinite, Utilities: utilities,
  Sensor_HOURS_24_MS: 86400000,
  ScriptApp: { AuthMode: { FULL: 'FULL' }, getAuthorizationInfo: (_mode, scopes) => { requestedScopes = scopes; return { getAuthorizationStatus: () => authStatus, getAuthorizationUrl: () => 'https://script.google.com/macros/d/test/usercallback' }; } },
  getSystemMemory: () => state,
  mutateNVRAM: (fn) => fn(state),
  Memory_hashFeature_: () => ({ index: 123 }),
  _orchestratorEscapeHtml_: (value) => String(value),
  _rawSystemNotify: (message) => { notifiedMessage = String(message); return true; },
  executeWithResilience: (_name, fn) => fn(),
  sendSystemTelemetry: () => {},
  invokeUniversalLLM: () => ({ sintomatologia_fisica: [], carga_alostatica_percibida: [], adherencia_nutricional: [], intenciones_futuras: [], activity_sessions: [{ source_app: 'Mi Fitness', activity_date_local: '2026-11-07', activity_time_local: '17:13', distance_km: 5, duration_seconds: 1500, displayed_avg_pace_seconds_per_km: 300 }] })
};
vm.createContext(context);
for (const file of ['02_Mem_Hierarchical.js', '03b_Net_Webhook.js', '05_Bio_Compiler.js', '06_Agent_Orchestrator.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}
context.getSystemMemory = () => state;
context.mutateNVRAM = (fn) => fn(state.NVRAM);

const assessment = context._orchestratorHistoryRequest_('Dentro de categorías nacionales CR, ¿dónde me ubico? Clasifica el rendimiento de mi última carrera.');
assert.equal(assessment.type, 'running_assessment', 'classification should fetch one run, not answer with a two-run comparison');
assert.equal(assessment.count, 1);
assert.equal(assessment.needsBenchmark, true);
const comparison = context._orchestratorHistoryRequest_('Contrasta mis dos carreras más recientes: ¿mejoró mi avg pace?');
assert.equal(comparison.type, 'running_comparison', 'pace comparison should fetch two runs');
const authorization = context._bioosGoogleFitLocationAuthorization_();
assert.equal(authorization.status, 'REQUIRED');
assert.deepEqual(Array.from(requestedScopes), ['https://www.googleapis.com/auth/fitness.location.read'], 'reauth must check only the minimal distance read scope');
context._handleBypassCommand('/reauth', '123');
assert.match(notifiedMessage, /https:\/\/script\.google\.com\/macros\/d\/test\/usercallback/, 'private reauth command should expose the returned URL when required');
authStatus = 'NOT_REQUIRED';
assert.equal(context._bioosGoogleFitLocationAuthorization_().status, 'NOT_REQUIRED');
context._handleBypassCommand('/reauth', '123');
assert.doesNotMatch(notifiedMessage, /usercallback/, 'already authorized scope should not issue a consent URL');
const compiled = context.compileQualitativeFeedback(JSON.stringify({ _type: 'bioos_ingress_batch', items: [{ kind: 'photo', eventId: 'photo-evidence-1', data: 'synthetic-image-data' }] }));
assert.equal(compiled.activity_sessions[0].evidenceEventId, 'photo-evidence-1', 'image extraction must be anchored to the Telegram photo event');

const fitStart = Date.parse('2026-11-07T17:19:00-06:00');
context.Memory_storeRunningSessions({ source: 'google_fit', fetchedAt: new Date().toISOString(), sessions: [{ id: 'fit-1', startMs: fitStart, endMs: fitStart + 3600000, activityType: 8, durationMinutes: 60, distanceKm: null }] });
const stored = context.Memory_storeReportedRunningSessions([{ evidenceEventId: 'telegram-photo-1', source_app: 'Mi Fitness', activity_date_local: '2026-11-07', activity_time_local: '17:13', distance_km: 5, duration_seconds: 1500, displayed_avg_pace_seconds_per_km: 300, average_heart_rate_bpm: 150, max_heart_rate_bpm: 170 }], { requestId: 'request-1' });
assert.equal(stored.stored, 1, 'valid visual report should be persisted');
assert.equal(stored.sessions[0].status, 'reported', 'source must remain user-reported');
assert.equal(stored.sessions[0].googleFitSessionId, 'fit-1', 'single close Fit session should be linked as probable');
assert.equal(stored.sessions[0].paceConsistency, 'consistent', 'visible pace should be checked against duration/distance');
assert.equal(context.Memory_storeReportedRunningSessions([{ source_app: 'Mi Fitness', distance_km: 5, duration_seconds: 1500 }], {}).stored, 0, 'unanchored model output must not enter memory');
console.log('PASS running operation routing and provenance-preserving activity memory');
}

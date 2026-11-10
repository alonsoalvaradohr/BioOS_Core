/* Contract tests for natural-language running history and exact Google Fit session reads. */
if (typeof require !== 'undefined') {
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

const calls = [];
const sessionRows = [
  { id: 'run-new', activityType: 8, startTimeMillis: 2000, endTimeMillis: 3800, activeTimeMillis: 1700, application: { name: 'Mi Fitness' } },
  { id: 'run-old', activityType: 56, startTimeMillis: 1000, endTimeMillis: 2800, application: { name: 'Mi Fitness' } },
  { id: 'walk', activityType: 7, startTimeMillis: 3000, endTimeMillis: 4000 }
];
function response(code, body) { return { getResponseCode: () => code, getContentText: () => JSON.stringify(body) }; }
const context = {
  console, Date, Math, String, Number, Array, Object, JSON, RegExp, isFinite,
  Sensor_HOURS_24_MS: 86400000,
  ScriptApp: { getOAuthToken: () => 'test-token' },
  Utilities: { formatDate: (date, _tz, pattern) => pattern === 'yyyy-MM-dd HH:mm' ? date.toISOString() : date.toISOString().slice(0, 10) },
  UrlFetchApp: {
    fetch: (url) => { calls.push(url); return response(200, { session: sessionRows }); },
    fetchAll: (requests) => requests.map((request, index) => {
      calls.push(request.url);
      return response(200, { bucket: [{ dataset: [{ point: [{ value: [{ fpVal: index === 0 ? 6000 : 5000 }] }] }] }] });
    })
  },
  _orchestratorEscapeHtml_: (value) => String(value)
};
vm.createContext(context);
for (const file of ['sensors/00_Sensor_Contracts.js', 'sensors/02_GoogleFit_Provider.js', '06_Agent_Orchestrator.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}

const request = context._orchestratorHistoryRequest_('Contrasta mis últimas dos carreras, ¿hubo mejoría en mi avg pace?');
assert.equal(request.type, 'running_comparison', 'natural running comparison should route to historical reader');
const history = context.Sensor_GoogleFit_fetchRecentRuns_({ startMs: 500, endMs: 5000, count: 2 });
assert.equal(history.sessionCount, 2, 'only the two running session types should be selected');
assert.deepEqual(Array.from(history.sessions, (s) => s.id), ['run-new', 'run-old'], 'runs should be ordered newest first');
assert.equal(history.sessions[0].distanceKm, 6, 'distance should be fetched for each exact session');
assert.equal(history.sessions[0].durationKind, 'active', 'Fit active time should be preserved explicitly');
assert.equal(calls.length, 3, 'one session list and two session-bounded distance reads expected');
console.log('PASS historical running query routing and Google Fit session extraction');
}

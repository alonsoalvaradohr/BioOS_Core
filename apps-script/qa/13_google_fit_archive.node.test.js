/* Node-only contract tests for durable Google Fit history and coverage semantics. */
if (typeof require !== 'undefined') {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const assert = require('node:assert/strict');

  let catalog = { schemaVersion: 1, lastSync: { status: 'COMPLETE' },
    coverage: [{ sinceMs: 1000, endMs: 5000 }], archiveGaps: [],
    shards: [{ dataTypeName: 'com.google.step_count.cadence', fileId: 'shard-1', dataStreamId: 'mi-fit', minTimeMs: 1000, maxTimeMs: 5000 }] };
  const points = [1200, 2400, 4800].map((t, index) => ({ endTimeNanos: String(t) + '000000', value: [{ fpVal: [159, 92, 173][index] }] }));
  const context = {
    Date, Math, String, Number, Array, Object, JSON, RegExp, isFinite,
    Sensor_HOURS_24_MS: 86400000,
    _memUtf8ByteLength_: (value) => Buffer.byteLength(value, 'utf8'),
    Sensor_safeError_: (error) => String(error),
    Sensor_boundedJson_: JSON.parse,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    DriveApp: { getFileById: () => ({ getBlob: () => ({}) }) },
    Utilities: { ungzip: () => ({ getDataAsString: () => JSON.stringify({ points }) }) },
    _bioosFitArchiveReadCatalog_: () => catalog
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sensors', '03_GoogleFit_Archive.js'), 'utf8'), context, { filename: '03_GoogleFit_Archive.js' });
  context._bioosFitArchiveReadCatalog_ = () => catalog;

  assert.equal(context._bioosFitArchiveCoverageComplete_([{ sinceMs: 0, endMs: 200 }, { sinceMs: 200, endMs: 500 }], 0, 500), true, 'adjacent ranges are complete');
  assert.equal(context._bioosFitArchiveCoverageComplete_([{ sinceMs: 0, endMs: 199 }, { sinceMs: 200, endMs: 500 }], 0, 500), false, 'one millisecond hole must not be called complete');
  assert.equal(context._bioosFitPointNumber_({ fpVal: 159 }), 159);
  assert.equal(context._bioosFitPointNumber_({ intVal: 'bad' }), null);

  const minimum = context.Sensor_GoogleFit_queryArchiveStats_({ dataTypeName: 'com.google.step_count.cadence', startMs: 1000, endMs: 5000 });
  assert.equal(minimum.state, 'OBSERVED');
  assert.equal(minimum.min, 92);
  assert.equal(minimum.max, 173);
  assert.equal(minimum.records, 3);
  assert.equal(minimum.completeCoverage, true);

  catalog.archiveGaps.push({ dataType: 'com.google.step_count.cadence', sinceMs: 2000, endMs: 3000, httpStatus: 403 });
  const gapped = context.Sensor_GoogleFit_queryArchiveStats_({ dataTypeName: 'com.google.step_count.cadence', startMs: 1000, endMs: 5000 });
  assert.equal(gapped.state, 'PARTIAL_ACCESS_GAP', 'an access gap must prevent an absolute-minimum claim');
  assert.equal(gapped.completeCoverage, false);
  const outsideGap = context.Sensor_GoogleFit_queryArchiveStats_({ dataTypeName: 'com.google.step_count.cadence', startMs: 3000, endMs: 5000 });
  assert.equal(outsideGap.state, 'OBSERVED', 'a gap must not poison unrelated time windows');
  const publicJob = context._bioosFitArchivePublicJob_({ status: 'RUNNING', sourceIndex: 0, sources: [{ dataType: { name: 'com.google.step_count.delta' } }], sinceMs: 0, endMs: 1000, pagesProcessed: 5, lastProgressAt: '2026-11-09T12:00:00.000Z' });
  assert.equal(publicJob.pagesProcessed, 5, 'status should expose page progress while current sourceIndex remains zero');
  assert.equal(publicJob.currentDataType, 'com.google.step_count.delta');

  let activeJob = { status: 'RUNNING', sinceMs: 0, endMs: 1000, sources: [], sourceIndex: 0 };
  let lockUsed = false, triggerDeleted = false;
  context.executeWithMutex = (_name, fn) => { lockUsed = true; return fn(); };
  context._bioosFitArchiveReadJob_ = () => activeJob;
  context.PropertiesService = { getScriptProperties: () => ({ setProperty: (_key, value) => { activeJob = JSON.parse(value); } }) };
  context._bioosFitArchiveDeleteWorkerTriggers_ = () => { triggerDeleted = true; };
  const pause = context.Sensor_GoogleFit_pauseArchiveSync_();
  assert.equal(pause.job.status, 'PAUSED');
  assert.equal(activeJob.status, 'PAUSED');
  assert.equal(lockUsed, true, 'pause must serialize with worker execution');
  assert.equal(triggerDeleted, true, 'pause removes any pending worker trigger');
  console.log('PASS archive coverage, exact stats, page status, and serialized pause');
}

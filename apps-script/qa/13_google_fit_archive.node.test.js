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
  console.log('PASS Google Fit archive coverage, exact stats, and time-bounded access gaps');
}

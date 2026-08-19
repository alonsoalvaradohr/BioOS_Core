/** Google Fit REST contingency. Requires OAuth scopes plus Fitness API enabled in the Cloud project. */
function Sensor_GoogleFit_fetchFallback(options) {
  var sinceMs = options && typeof options.sinceMs === 'number' ? options.sinceMs : Date.now() - Sensor_HOURS_24_MS;
  try {
    var props = PropertiesService.getScriptProperties(), now = Date.now(), last = Number(props.getProperty('SENSOR_GOOGLE_FIT_LAST_ATTEMPT_MS') || 0);
    if (last && now - last < Sensor_GOOGLE_FIT_FALLBACK_MS) return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_RATE_LIMITED', { retryAfterMs: Sensor_GOOGLE_FIT_FALLBACK_MS - (now - last), lastAttemptMs: last });
    props.setProperty('SENSOR_GOOGLE_FIT_LAST_ATTEMPT_MS', String(now));
    return Sensor_GoogleFit_fetchSnapshot_({ sinceMs: sinceMs, endMs: now });
  } catch (error) { Sensor_logWarning_('[SENSOR] Google Fit unavailable: ' + Sensor_safeError_(error)); return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_REQUEST_FAILED', { error: Sensor_safeError_(error) }); }
}
function Sensor_GoogleFit_fetchSnapshot_(range) {
  if (typeof ScriptApp === 'undefined' || typeof UrlFetchApp === 'undefined') return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_UNSUPPORTED_RUNTIME', {});
  var token = ScriptApp.getOAuthToken(); if (!token) return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_AUTH_UNAVAILABLE', {});
  var payload = { startTimeMillis: String(range.sinceMs), endTimeMillis: String(range.endMs), bucketByTime: { durationMillis: String(range.endMs - range.sinceMs) }, aggregateBy: [{ dataTypeName: 'com.google.heart_rate.bpm' }, { dataTypeName: 'com.google.step_count.delta' }, { dataTypeName: 'com.google.sleep.segment' }] };
  var response = UrlFetchApp.fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false }), status = response.getResponseCode();
  if (status < 200 || status >= 300) return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_HTTP_' + status, { httpStatus: status });
  var parsed = Sensor_boundedJson_(response.getContentText()), data = Sensor_GoogleFit_normalizeAggregate_(parsed);
  return Sensor_snapshot('google_fit', range.sinceMs, data, null, { httpStatus: status, buckets: Array.isArray(parsed.bucket) ? parsed.bucket.length : 0 });
}
function Sensor_GoogleFit_normalizeAggregate_(payload) {
  var values = { rhrBpm: [], steps: [], sleepMinutes: [] }, buckets = payload && Array.isArray(payload.bucket) ? payload.bucket : [];
  buckets.forEach(function (bucket) { (bucket.dataset || []).forEach(function (dataset) { (dataset.point || []).forEach(function (point) { var type = Sensor_GoogleFit_dataType_(point, dataset), value = point.value && point.value[0] || {}, n = value.fpVal !== undefined ? Number(value.fpVal) : Number(value.intVal); if (type === 'com.google.heart_rate.bpm' && isFinite(n)) values.rhrBpm.push(n); if (type === 'com.google.step_count.delta' && isFinite(n)) values.steps.push(n); if (type === 'com.google.sleep.segment') { var duration = Math.max(0, Number(point.endTimeNanos || 0) - Number(point.startTimeNanos || 0)) / 60000000000; if (isFinite(duration)) values.sleepMinutes.push(duration); } }); }); });
  return { rhrBpm: values.rhrBpm.length ? values.rhrBpm.reduce(function (a, b) { return a + b; }, 0) / values.rhrBpm.length : null, steps: values.steps.length ? values.steps.reduce(function (a, b) { return a + b; }, 0) : null, sleepMinutes: values.sleepMinutes.length ? values.sleepMinutes.reduce(function (a, b) { return a + b; }, 0) : null };
}
function Sensor_GoogleFit_dataType_(point, dataset) { var value = point.dataTypeName || dataset.dataTypeName || dataset.dataSourceId || ''; if (value.indexOf('com.google.heart_rate.bpm') !== -1) return 'com.google.heart_rate.bpm'; if (value.indexOf('com.google.step_count.delta') !== -1) return 'com.google.step_count.delta'; if (value.indexOf('com.google.sleep.segment') !== -1) return 'com.google.sleep.segment'; return ''; }

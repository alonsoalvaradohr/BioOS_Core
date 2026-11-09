/** Google Fit REST contingency. Requires OAuth scopes plus Fitness API enabled in the Cloud project. */
function Sensor_GoogleFit_fetchFallback(options) {
  var now = Date.now();
  var sinceMs = options && typeof options.sinceMs === 'number' ? options.sinceMs : Sensor_localDayStartMs_(now);
  try {
    var props = PropertiesService.getScriptProperties(), last = Number(props.getProperty('SENSOR_GOOGLE_FIT_LAST_ATTEMPT_MS') || 0);
  var endMs = (options && options.endMs) || now;
    var sleepSinceMs = options && options.sleepSinceMs;
    var sleepEndMs = options && options.sleepEndMs;
    var cacheRangeKey = [sinceMs, endMs, sleepSinceMs || '', sleepEndMs || ''].join('_');
    var lastRange = String(props.getProperty('SENSOR_GOOGLE_FIT_LAST_RANGE_KEY') || '');
    if (last && lastRange === cacheRangeKey && now - last < Sensor_GOOGLE_FIT_FALLBACK_MS) {
      var cached = Sensor_GoogleFit_readCachedSnapshot_(cacheRangeKey);
      if (cached) {
        cached.metadata = cached.metadata || {};
        cached.metadata.cacheHit = true;
        cached.metadata.cacheAgeMs = Math.max(0, now - Date.parse(cached.fetchedAt));
        return cached;
      }
      return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_RATE_LIMITED', { retryAfterMs: Sensor_GOOGLE_FIT_FALLBACK_MS - (now - last), lastAttemptMs: last });
    }
    props.setProperty('SENSOR_GOOGLE_FIT_LAST_ATTEMPT_MS', String(now));
    props.setProperty('SENSOR_GOOGLE_FIT_LAST_RANGE_KEY', cacheRangeKey);
    var snapshot = Sensor_GoogleFit_fetchSnapshot_({ sinceMs: sinceMs, endMs: endMs, sleepSinceMs: sleepSinceMs, sleepEndMs: sleepEndMs });
    if (snapshot && snapshot.available) Sensor_GoogleFit_cacheSnapshot_(snapshot, cacheRangeKey);
    return snapshot;
  } catch (error) { Sensor_logWarning_('[SENSOR] Google Fit unavailable: ' + Sensor_safeError_(error)); return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_REQUEST_FAILED', { error: Sensor_safeError_(error) }); }
}
function Sensor_GoogleFit_cacheKey_(rangeKey) { return 'BIOOS_GOOGLE_FIT_SNAPSHOT_V3_' + String(rangeKey); }
function Sensor_GoogleFit_readCachedSnapshot_(rangeKey) {
  try {
    if (typeof CacheService === 'undefined') return null;
    var raw = CacheService.getScriptCache().get(Sensor_GoogleFit_cacheKey_(rangeKey));
    if (!raw) return null;
    var snapshot = JSON.parse(raw);
    return snapshot && snapshot.source === 'google_fit' && snapshot.available && snapshot.data ? snapshot : null;
  } catch (error) { Sensor_logWarning_('[SENSOR] Google Fit cache read failed: ' + Sensor_safeError_(error)); return null; }
}
function Sensor_GoogleFit_cacheSnapshot_(snapshot, rangeKey) {
  try {
    if (typeof CacheService === 'undefined') return;
    CacheService.getScriptCache().put(Sensor_GoogleFit_cacheKey_(rangeKey), JSON.stringify(snapshot), 600);
  } catch (error) { Sensor_logWarning_('[SENSOR] Google Fit cache write failed: ' + Sensor_safeError_(error)); }
}
function Sensor_GoogleFit_fetchSnapshot_(range) {
  if (typeof ScriptApp === 'undefined' || typeof UrlFetchApp === 'undefined') return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_UNSUPPORTED_RUNTIME', {});
  var token = ScriptApp.getOAuthToken();
  if (!token) return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_AUTH_UNAVAILABLE', {});

  var bucketsDefs = [
    {
      name: 'activity',
      aggregateBy: [
        { dataTypeName: 'com.google.step_count.delta' },
        { dataTypeName: 'com.google.calories.expended' }
      ]
    },
    {
      name: 'sleep',
      aggregateBy: [
        { dataTypeName: 'com.google.sleep.segment' }
      ]
    },
    {
      name: 'location',
      aggregateBy: [
        { dataTypeName: 'com.google.distance.delta' }
      ]
    }
  ];

  var requests = bucketsDefs.map(function(b) {
    return {
      url: 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        startTimeMillis: String(b.name === 'sleep' ? (range.sleepSinceMs || range.endMs - Sensor_HOURS_24_MS) : range.sinceMs),
        endTimeMillis: String(b.name === 'sleep' ? (range.sleepEndMs || range.endMs) : range.endMs),
        bucketByTime: { durationMillis: String(b.name === 'sleep'
          ? ((range.sleepEndMs || range.endMs) - (range.sleepSinceMs || range.endMs - Sensor_HOURS_24_MS))
          : (range.endMs - range.sinceMs)) },
        aggregateBy: b.aggregateBy
      }),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
      followRedirects: false
    };
  });

  var responses = [];
  try {
    if (typeof UrlFetchApp.fetchAll === 'function') {
      responses = UrlFetchApp.fetchAll(requests);
    } else {
      responses = requests.map(function(req) { return UrlFetchApp.fetch(req.url, req); });
    }
  } catch (netErr) {
    Sensor_logWarning_('[SENSOR] UrlFetchApp failed during Google Fit batch: ' + Sensor_safeError_(netErr));
    responses = requests.map(function(req) {
      try {
        return UrlFetchApp.fetch(req.url, req);
      } catch (atomicErr) {
        return {
          getResponseCode: function() { return 500; },
          getContentText: function() { return JSON.stringify({ error: atomicErr.message }); }
        };
      }
    });
  }

  var combinedBuckets = [];
  var telemetryReport = {};
  var successfulQueries = 0;

  responses.forEach(function(resp, idx) {
    var bName = bucketsDefs[idx].name;
    var status = (resp && typeof resp.getResponseCode === 'function') ? resp.getResponseCode() : 500;
    var bodyText = (resp && typeof resp.getContentText === 'function') ? resp.getContentText() : '';

    if (status >= 200 && status < 300) {
      successfulQueries++;
      try {
        var parsed = Sensor_boundedJson_(bodyText);
        if (parsed && Array.isArray(parsed.bucket)) {
          combinedBuckets = combinedBuckets.concat(parsed.bucket);
        }
        telemetryReport[bName] = { ok: true, httpStatus: status };
      } catch (parseErr) {
        telemetryReport[bName] = { ok: false, httpStatus: status, error: 'JSON_PARSE_ERROR' };
      }
    } else {
      telemetryReport[bName] = {
        ok: false,
        httpStatus: status,
        errorResponse: bodyText.slice(0, 200)
      };
      Sensor_logWarning_('[SENSOR] Google Fit ' + bName + ' metric degraded: HTTP ' + status);
    }
  });

  if (successfulQueries === 0) {
    return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_ALL_METRICS_FAILED', { telemetryReport: telemetryReport });
  }

  var parsedAggregate = { bucket: combinedBuckets };
  var data = Sensor_GoogleFit_normalizeAggregate_(parsedAggregate);

  var hasPoints = data.steps !== null || data.rhrBpm !== null || data.caloriesKcal !== null || data.distanceKm !== null || data.sleepMinutes !== null;

  return Sensor_snapshot('google_fit', range.sinceMs, data, null, {
    telemetryReport: telemetryReport,
    successfulQueries: successfulQueries,
    totalQueries: bucketsDefs.length,
    dailyWindow: { startMs: range.sinceMs, endMs: range.endMs },
    sleepWindow: { startMs: range.sleepSinceMs || range.endMs - Sensor_HOURS_24_MS, endMs: range.sleepEndMs || range.endMs },
    timeZone: (typeof Session !== 'undefined' && Session.getScriptTimeZone) ? Session.getScriptTimeZone() : 'unknown',
    emptyDataWindow: !hasPoints
  });
}

/** Read-only daily series for historical questions; each returned day is a separate Fit bucket. */
function Sensor_GoogleFit_fetchDailyHistory_(startMs, endMs) {
  if (typeof ScriptApp === 'undefined' || typeof UrlFetchApp === 'undefined') return { available: false, reason: 'GOOGLE_FIT_UNSUPPORTED_RUNTIME', days: [] };
  var span = Number(endMs) - Number(startMs), dayMs = Sensor_HOURS_24_MS;
  if (!(span > 0 && span <= 32 * dayMs)) return { available: false, reason: 'HISTORY_WINDOW_INVALID', days: [] };
  var token = ScriptApp.getOAuthToken();
  if (!token) return { available: false, reason: 'GOOGLE_FIT_AUTH_UNAVAILABLE', days: [] };
  var reqs = [
    { types: [{ dataTypeName: 'com.google.step_count.delta' }, { dataTypeName: 'com.google.distance.delta' }, { dataTypeName: 'com.google.calories.expended' }], start: startMs, end: endMs },
    { types: [{ dataTypeName: 'com.google.sleep.segment' }], start: startMs - dayMs, end: endMs }
  ].map(function (q) { return { url: 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', method: 'post', contentType: 'application/json', payload: JSON.stringify({ startTimeMillis: String(q.start), endTimeMillis: String(q.end), bucketByTime: { durationMillis: String(dayMs) }, aggregateBy: q.types }), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false }; });
  try {
    var responses = UrlFetchApp.fetchAll(reqs), byDay = {};
    responses.forEach(function (resp, idx) {
      if (!resp || resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) throw new Error('GOOGLE_FIT_HISTORY_HTTP_' + (resp && resp.getResponseCode()));
      var body = Sensor_boundedJson_(resp.getContentText()), buckets = Array.isArray(body.bucket) ? body.bucket : [];
      buckets.forEach(function (bucket) {
        var start = Number(bucket.startTimeMillis), bucketDay = idx === 1 ? start + dayMs : start;
        var tz = typeof Session !== 'undefined' && Session.getScriptTimeZone ? Session.getScriptTimeZone() : 'America/Costa_Rica';
        var key = Utilities.formatDate(new Date(bucketDay), tz, 'yyyy-MM-dd');
        if (!byDay[key]) byDay[key] = { date: key, steps: null, distanceKm: null, caloriesKcal: null, sleepMinutes: null, sources: ['google_fit'] };
        (bucket.dataset || []).forEach(function (dataset) { (dataset.point || []).forEach(function (point) {
          var kind = Sensor_GoogleFit_dataType_(point, dataset), val = point.value && point.value[0] || {};
          if (kind === 'step_count') byDay[key].steps = (byDay[key].steps || 0) + Number(val.intVal || val.fpVal || 0);
          else if (kind === 'distance') byDay[key].distanceKm = (byDay[key].distanceKm || 0) + Number(val.fpVal || val.intVal || 0) / 1000;
          else if (kind === 'calories') byDay[key].caloriesKcal = (byDay[key].caloriesKcal || 0) + Number(val.fpVal || val.intVal || 0);
          else if (kind === 'sleep') {
            var stage = Number(val.intVal), mins = Math.max(0, Number(point.endTimeNanos || 0) - Number(point.startTimeNanos || 0)) / 60000000000;
            if ([0, 2, 4, 5, 6].indexOf(stage) !== -1 && mins > 0) byDay[key].sleepMinutes = (byDay[key].sleepMinutes || 0) + mins;
          }
        }); });
      });
    });
    var rows = Object.keys(byDay).sort().map(function (key) { var d = byDay[key]; if (d.steps === null && d.distanceKm === null && d.sleepMinutes === null && d.caloriesKcal === null) return d; if (d.distanceKm !== null) d.distanceKm = Number(d.distanceKm.toFixed(2)); if (d.caloriesKcal !== null) d.caloriesKcal = Math.round(d.caloriesKcal); if (d.sleepMinutes !== null) d.sleepMinutes = Math.round(d.sleepMinutes); return d; });
    return { available: true, source: 'google_fit', fetchedAt: new Date().toISOString(), window: { startMs: startMs, endMs: endMs }, days: rows };
  } catch (error) { return { available: false, source: 'google_fit', reason: Sensor_safeError_(error), days: [] }; }
}

function Sensor_GoogleFit_normalizeAggregate_(payload) {
  var values = { steps: [], distanceMeters: [], caloriesKcal: [], sleepMinutes: [] };
  if (!payload || typeof payload !== 'object') {
    return { rhrBpm: null, steps: null, distanceMeters: null, distanceKm: null, caloriesKcal: null, sleepMinutes: null };
  }
  var buckets = Array.isArray(payload.bucket) ? payload.bucket : [];

  buckets.forEach(function (bucket) {
    if (!bucket || typeof bucket !== 'object') return;
    var datasets = Array.isArray(bucket.dataset) ? bucket.dataset : [];
    datasets.forEach(function (dataset) {
      if (!dataset || typeof dataset !== 'object') return;
      var points = Array.isArray(dataset.point) ? dataset.point : [];
      points.forEach(function (point) {
        if (!point || typeof point !== 'object') return;
        var type = Sensor_GoogleFit_dataType_(point, dataset);
        var vals = Array.isArray(point.value) ? point.value : [];
        if (!vals.length || !vals[0] || typeof vals[0] !== 'object') return;

        if (type === 'step_count') {
          var stepVal = vals[0].intVal !== undefined ? Number(vals[0].intVal) : Number(vals[0].fpVal || 0);
          if (isFinite(stepVal) && stepVal > 0) values.steps.push(stepVal);
        } else if (type === 'distance') {
          var distVal = vals[0].fpVal !== undefined ? Number(vals[0].fpVal) : Number(vals[0].intVal || 0);
          if (isFinite(distVal) && distVal > 0) values.distanceMeters.push(distVal);
        } else if (type === 'calories') {
          var calVal = vals[0].fpVal !== undefined ? Number(vals[0].fpVal) : Number(vals[0].intVal || 0);
          if (isFinite(calVal) && calVal > 0) values.caloriesKcal.push(calVal);
        } else if (type === 'sleep') {
          var sleepStage = Number(vals[0].intVal);
          // Fit sleep segments include awake and out-of-bed intervals; they
          // are not sleep duration. Keep only explicit asleep/unknown stages.
          if ([0, 2, 4, 5, 6].indexOf(sleepStage) === -1) return;
          var duration = Math.max(0, Number(point.endTimeNanos || 0) - Number(point.startTimeNanos || 0)) / 60000000000;
          if (isFinite(duration) && duration > 0) values.sleepMinutes.push(duration);
        }
      });
    });
  });

  var totalSteps = values.steps.length ? values.steps.reduce(function (a, b) { return a + b; }, 0) : null;
  var totalDistMeters = values.distanceMeters.length ? values.distanceMeters.reduce(function (a, b) { return a + b; }, 0) : null;
  var totalDistanceKm = totalDistMeters !== null ? Number((totalDistMeters / 1000).toFixed(2)) : null;
  var totalCalories = values.caloriesKcal.length ? Math.round(values.caloriesKcal.reduce(function (a, b) { return a + b; }, 0)) : null;
  var totalSleep = values.sleepMinutes.length ? Math.round(values.sleepMinutes.reduce(function (a, b) { return a + b; }, 0)) : null;

  return {
    rhrBpm: null,
    steps: totalSteps,
    distanceMeters: totalDistMeters,
    distanceKm: totalDistanceKm,
    caloriesKcal: totalCalories,
    sleepMinutes: totalSleep
  };
}

function Sensor_GoogleFit_dataType_(point, dataset) {
  var str = ((point && typeof point.dataTypeName === 'string' ? point.dataTypeName : '') + ' ' +
             (dataset && typeof dataset.dataTypeName === 'string' ? dataset.dataTypeName : '') + ' ' +
             (dataset && typeof dataset.dataSourceId === 'string' ? dataset.dataSourceId : '')).toLowerCase();
  if (str.indexOf('step') !== -1) return 'step_count';
  if (str.indexOf('distance') !== -1) return 'distance';
  if (str.indexOf('calorie') !== -1 || str.indexOf('calories') !== -1) return 'calories';
  if (str.indexOf('heart') !== -1 || str.indexOf('bpm') !== -1) return 'heart_rate';
  if (str.indexOf('sleep') !== -1) return 'sleep';
  return '';
}

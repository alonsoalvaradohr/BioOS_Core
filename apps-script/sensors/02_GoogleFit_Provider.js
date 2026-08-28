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
      name: 'heart_rate',
      aggregateBy: [
        { dataTypeName: 'com.google.heart_rate.bpm' }
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
        startTimeMillis: String(range.sinceMs),
        endTimeMillis: String(range.endMs),
        bucketByTime: { durationMillis: String(range.endMs - range.sinceMs) },
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
    emptyDataWindow: !hasPoints
  });
}

function Sensor_GoogleFit_normalizeAggregate_(payload) {
  var values = { rhrBpm: [], steps: [], distanceMeters: [], caloriesKcal: [], sleepMinutes: [] };
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
        } else if (type === 'heart_rate') {
          var hrVal = vals[0].fpVal !== undefined ? Number(vals[0].fpVal) : Number(vals[0].intVal || 0);
          if (isFinite(hrVal) && hrVal > 0) values.rhrBpm.push(hrVal);
        } else if (type === 'sleep') {
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
  var avgRhr = values.rhrBpm.length ? Math.round(values.rhrBpm.reduce(function (a, b) { return a + b; }, 0) / values.rhrBpm.length) : null;
  var totalSleep = values.sleepMinutes.length ? Math.round(values.sleepMinutes.reduce(function (a, b) { return a + b; }, 0)) : null;

  return {
    rhrBpm: avgRhr,
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

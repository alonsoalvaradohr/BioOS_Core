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
        var parsedBuckets = parsed && Array.isArray(parsed.bucket) ? parsed.bucket : [];
        combinedBuckets = combinedBuckets.concat(parsedBuckets);
        var metricPointCounts = {};
        parsedBuckets.forEach(function (bucket) { (bucket.dataset || []).forEach(function (dataset) {
          var type = String(dataset.dataTypeName || dataset.dataSourceId || bucketsDefs[idx].name);
          metricPointCounts[type] = (metricPointCounts[type] || 0) + ((dataset.point || []).length);
        }); });
        telemetryReport[bName] = { ok: true, httpStatus: status, metricPointCounts: metricPointCounts };
      } catch (parseErr) {
        telemetryReport[bName] = { ok: false, httpStatus: status, error: 'JSON_PARSE_ERROR' };
      }
    } else {
      telemetryReport[bName] = {
        ok: false,
        httpStatus: status,
        error: Sensor_GoogleFit_safeHttpError_(bodyText)
      };
      Sensor_logWarning_('[SENSOR] Google Fit ' + bName + ' metric degraded: HTTP ' + status);
    }
  });

  if (successfulQueries === 0) {
    return Sensor_unavailableSnapshot('google_fit', 'GOOGLE_FIT_ALL_METRICS_FAILED', { telemetryReport: telemetryReport });
  }

  var parsedAggregate = { bucket: combinedBuckets };
  var data = Sensor_GoogleFit_normalizeAggregate_(parsedAggregate);
  var sleepSessions = Sensor_GoogleFit_sessionsFromSleepBuckets_(combinedBuckets);

  var hasPoints = data.steps !== null || data.rhrBpm !== null || data.caloriesKcal !== null || data.distanceKm !== null || data.sleepMinutes !== null;

  return Sensor_snapshot('google_fit', range.sinceMs, data, null, {
    telemetryReport: telemetryReport,
    sleepSessions: sleepSessions,
    successfulQueries: successfulQueries,
    totalQueries: bucketsDefs.length,
    dailyWindow: { startMs: range.sinceMs, endMs: range.endMs },
    sleepWindow: { startMs: range.sleepSinceMs || range.endMs - Sensor_HOURS_24_MS, endMs: range.sleepEndMs || range.endMs },
    timeZone: (typeof Session !== 'undefined' && Session.getScriptTimeZone) ? Session.getScriptTimeZone() : 'unknown',
    emptyDataWindow: !hasPoints
  });
}

/** Keep only Google's non-sensitive status/code fields; never echo arbitrary response bodies. */
function Sensor_GoogleFit_safeHttpError_(bodyText) {
  try {
    var parsed = Sensor_boundedJson_(bodyText), err = parsed && parsed.error || {};
    var parts = [];
    if (err.status && /^[A-Z_]{3,40}$/.test(String(err.status))) parts.push(String(err.status));
    if (err.code && isFinite(Number(err.code))) parts.push('code=' + Number(err.code));
    (Array.isArray(err.errors) ? err.errors : []).slice(0, 2).forEach(function (item) {
      var reason = String(item && item.reason || '');
      if (/^[a-zA-Z0-9_.-]{1,60}$/.test(reason)) parts.push('reason=' + reason);
    });
    return parts.join(', ') || 'GOOGLE_FIT_HTTP_ERROR';
  } catch (_) { return 'GOOGLE_FIT_HTTP_ERROR'; }
}

/** Fetch recent running sessions, then exact per-session distance. Never estimates pace from steps/calories. */
function Sensor_GoogleFit_fetchRecentRuns_(request) {
  if (typeof ScriptApp === 'undefined' || typeof UrlFetchApp === 'undefined') return { available: false, reason: 'GOOGLE_FIT_UNSUPPORTED_RUNTIME', sessions: [], status: {} };
  var token = ScriptApp.getOAuthToken();
  if (!token) return { available: false, reason: 'GOOGLE_FIT_AUTH_UNAVAILABLE', sessions: [], status: {} };
  var startMs = Number(request && request.startMs) || Date.now() - 180 * Sensor_HOURS_24_MS;
  var endMs = Number(request && request.endMs) || Date.now();
  if (!(endMs > startMs && endMs - startMs <= 366 * Sensor_HOURS_24_MS)) return { available: false, reason: 'RUN_HISTORY_WINDOW_INVALID', sessions: [], status: {} };
  var url = 'https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=' + encodeURIComponent(new Date(startMs).toISOString()) + '&endTime=' + encodeURIComponent(new Date(endMs).toISOString());
  var resp = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false });
  var status = { sessions: resp.getResponseCode(), distance: null }, candidates = [];
  if (status.sessions < 200 || status.sessions >= 300) {
    status.sessionsError = Sensor_GoogleFit_safeHttpError_(resp.getContentText());
    return { available: false, source: 'google_fit', fetchedAt: new Date().toISOString(), sessionCount: 0, sessions: [], status: status, reason: 'GOOGLE_FIT_SESSIONS_HTTP_' + status.sessions };
  }
  var data = Sensor_boundedJson_(resp.getContentText());
  (data.session || []).forEach(function (s) {
    var start = Number(s.startTimeMillis), end = Number(s.endTimeMillis), type = Number(s.activityType);
    // Google Fit ActivityType: 8 running, 56 jogging, 58 running on treadmill.
    if ([8, 56, 58].indexOf(type) === -1 || !isFinite(start) || !isFinite(end) || end <= start || start < startMs || end > endMs) return;
    var activeTime = Number(s.activeTimeMillis), wallTime = (end - start) / 60000;
    candidates.push({ id: String(s.id || start), startMs: start, endMs: end, activityType: type, name: String(s.name || ''), application: String((s.application || {}).name || (s.application || {}).packageName || ''), durationMinutes: activeTime > 0 ? activeTime / 60000 : wallTime, durationKind: activeTime > 0 ? 'active' : 'wall', wallMinutes: wallTime, distanceKm: null, source: 'Google Fit', sourceKind: 'google_fit_running_session' });
  });
  candidates.sort(function (a, b) { return b.startMs - a.startMs; });
  candidates = candidates.slice(0, Math.max(2, Math.min(5, Number(request && request.count) || 2)));
  if (candidates.length && (!request || request.includeDistance !== false)) {
    var requests = candidates.map(function (s) { return { url: 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', method: 'post', contentType: 'application/json', payload: JSON.stringify({ startTimeMillis: String(s.startMs), endTimeMillis: String(s.endMs), aggregateBy: [{ dataTypeName: 'com.google.distance.delta' }] }), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false }; });
    var distanceResponses = UrlFetchApp.fetchAll(requests), distanceStatuses = [];
    distanceResponses.forEach(function (distanceResp, index) {
      var code = distanceResp.getResponseCode(); distanceStatuses.push(code);
      if (code < 200 || code >= 300) { status.distanceError = Sensor_GoogleFit_safeHttpError_(distanceResp.getContentText()); return; }
      try {
        var aggregate = Sensor_boundedJson_(distanceResp.getContentText()), meters = 0;
        (aggregate.bucket || []).forEach(function (bucket) { (bucket.dataset || []).forEach(function (dataset) { (dataset.point || []).forEach(function (point) { var value = point.value && point.value[0] || {}; meters += Number(value.fpVal || value.intVal || 0); }); }); });
        if (meters > 0) candidates[index].distanceKm = meters / 1000;
      } catch (_) { status.distanceError = 'GOOGLE_FIT_DISTANCE_JSON_ERROR'; }
    });
    status.distance = distanceStatuses.every(function (code) { return code >= 200 && code < 300; }) ? 200 : distanceStatuses.filter(function (code) { return code < 200 || code >= 300; })[0];
    candidates.forEach(function (s) { s.durationMinutes = Number(s.durationMinutes.toFixed(2)); s.wallMinutes = Number(s.wallMinutes.toFixed(2)); if (s.distanceKm !== null) s.distanceKm = Number(s.distanceKm.toFixed(3)); });
  }
  return { available: true, source: 'google_fit', fetchedAt: new Date().toISOString(), window: { startMs: startMs, endMs: endMs }, sessionCount: candidates.length, sessions: candidates, status: status, reason: candidates.length ? null : 'NO_RUNNING_SESSIONS_IN_WINDOW' };
}

function Sensor_GoogleFit_sessionsFromSleepBuckets_(buckets) {
  var points = [];
  (buckets || []).forEach(function (bucket) { (bucket.dataset || []).forEach(function (dataset) {
    (dataset.point || []).forEach(function (point) {
      if (Sensor_GoogleFit_dataType_(point, dataset) !== 'sleep') return;
      var value = point.value && point.value[0] || {}, stage = Number(value.intVal), start = Math.floor(Number(point.startTimeNanos) / 1000000), end = Math.floor(Number(point.endTimeNanos) / 1000000);
      if (stage < 0 || stage > 6 || !isFinite(start) || !isFinite(end) || end <= start) return;
      points.push({ startMs: start, endMs: end, stage: stage });
    });
  }); });
  points.sort(function (a, b) { return a.startMs - b.startMs; });
  var sessions = [], current = null;
  points.forEach(function (point) {
    if (!current || point.startMs - current.endMs > 2 * 60 * 60 * 1000) {
      if (current) sessions.push(current);
      current = { id: 'sleep-segments-' + point.startMs, startMs: point.startMs, endMs: point.endMs, source: 'Google Fit sleep segments', sourceKind: 'google_fit_sleep_segments_window' };
    } else current.endMs = Math.max(current.endMs, point.endMs);
  });
  if (current) sessions.push(current);
  return sessions.map(function (session) {
    session.bedtimeDate = Utilities.formatDate(new Date(session.startMs), 'America/Costa_Rica', 'yyyy-MM-dd');
    session.bedtimeLocal = Utilities.formatDate(new Date(session.startMs), 'America/Costa_Rica', 'HH:mm');
    session.wakeDate = Utilities.formatDate(new Date(session.endMs), 'America/Costa_Rica', 'yyyy-MM-dd');
    session.wakeLocal = Utilities.formatDate(new Date(session.endMs), 'America/Costa_Rica', 'HH:mm');
    session.durationMinutes = Math.round((session.endMs - session.startMs) / 60000);
    return session;
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

/** Read exact sleep session bounds and stage points from Google Fit for circadian questions. */
function Sensor_GoogleFit_fetchSleepHistory_(startMs, endMs) {
  if (typeof ScriptApp === 'undefined' || typeof UrlFetchApp === 'undefined') return { available: false, reason: 'GOOGLE_FIT_UNSUPPORTED_RUNTIME', sessions: [], segments: [] };
  var span = Number(endMs) - Number(startMs), dayMs = Sensor_HOURS_24_MS;
  if (!(span > 0 && span <= 32 * dayMs)) return { available: false, reason: 'HISTORY_WINDOW_INVALID', sessions: [], segments: [] };
  var token = ScriptApp.getOAuthToken();
  if (!token) return { available: false, reason: 'GOOGLE_FIT_AUTH_UNAVAILABLE', sessions: [], segments: [] };
  var queryStart = Number(startMs) - dayMs, queryEnd = Number(endMs) + dayMs;
  var sessionUrl = 'https://www.googleapis.com/fitness/v1/users/me/sessions?activityType=72&startTime=' + encodeURIComponent(new Date(queryStart).toISOString()) + '&endTime=' + encodeURIComponent(new Date(queryEnd).toISOString());
  var requests = [
    { url: sessionUrl, method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false },
    { url: 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', method: 'post', contentType: 'application/json', payload: JSON.stringify({ startTimeMillis: String(queryStart), endTimeMillis: String(queryEnd), aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }] }), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false }
  ];
  try {
    var responses = UrlFetchApp.fetchAll(requests), sessionResponse = responses[0], segmentResponse = responses[1];
    var sessions = [], segments = [], status = { sessions: sessionResponse.getResponseCode(), segments: segmentResponse.getResponseCode() };
    if (status.sessions >= 200 && status.sessions < 300) {
      var sessionData = Sensor_boundedJson_(sessionResponse.getContentText());
      (sessionData.session || []).forEach(function (s) {
        var start = Number(s.startTimeMillis), end = Number(s.endTimeMillis);
        if (!isFinite(start) || !isFinite(end) || start <= 0 || end <= start) return;
        var app = s.application || {};
        sessions.push({ id: String(s.id || start + '-' + end), startMs: start, endMs: end, durationMinutes: Math.round((end - start) / 60000), bedtimeDate: Utilities.formatDate(new Date(start), 'America/Costa_Rica', 'yyyy-MM-dd'), bedtimeLocal: Utilities.formatDate(new Date(start), 'America/Costa_Rica', 'HH:mm'), wakeDate: Utilities.formatDate(new Date(end), 'America/Costa_Rica', 'yyyy-MM-dd'), wakeLocal: Utilities.formatDate(new Date(end), 'America/Costa_Rica', 'HH:mm'), source: String(app.name || app.packageName || 'Google Fit session'), activityType: Number(s.activityType) });
      });
    }
    if (status.segments >= 200 && status.segments < 300) {
      var aggregate = Sensor_boundedJson_(segmentResponse.getContentText());
      (aggregate.bucket || []).forEach(function (bucket) { (bucket.dataset || []).forEach(function (dataset) { (dataset.point || []).forEach(function (point) {
        var value = point.value && point.value[0] || {}, stage = Number(value.intVal), startNs = Number(point.startTimeNanos), endNs = Number(point.endTimeNanos);
        if ([0, 2, 4, 5, 6].indexOf(stage) === -1 || !isFinite(startNs) || !isFinite(endNs) || endNs <= startNs) return;
        var start = Math.floor(startNs / 1000000), end = Math.floor(endNs / 1000000);
        segments.push({ startMs: start, endMs: end, stage: stage, minutes: Math.round((end - start) / 60000) });
      }); }); });
    }
    sessions.sort(function (a, b) { return a.startMs - b.startMs; });
    segments.sort(function (a, b) { return a.startMs - b.startMs; });
    if (!sessions.length && segments.length) {
      var group = null, groups = [];
      segments.forEach(function (segment) {
        if (!group || segment.startMs - group.endMs > 90 * 60000) { if (group) groups.push(group); group = { startMs: segment.startMs, endMs: segment.endMs, durationMinutes: 0 }; }
        else group.endMs = Math.max(group.endMs, segment.endMs);
        group.durationMinutes += segment.minutes;
      });
      if (group) groups.push(group);
      sessions = groups.map(function (g) { return { id: 'segments-' + g.startMs, startMs: g.startMs, endMs: g.endMs, durationMinutes: g.durationMinutes,
        bedtimeDate: Utilities.formatDate(new Date(g.startMs), 'America/Costa_Rica', 'yyyy-MM-dd'), bedtimeLocal: Utilities.formatDate(new Date(g.startMs), 'America/Costa_Rica', 'HH:mm'),
        wakeDate: Utilities.formatDate(new Date(g.endMs), 'America/Costa_Rica', 'yyyy-MM-dd'), wakeLocal: Utilities.formatDate(new Date(g.endMs), 'America/Costa_Rica', 'HH:mm'), source: 'Google Fit sleep segments', sourceKind: 'google_fit_sleep_segments_window' }; });
    }
    var anyOk = (status.sessions >= 200 && status.sessions < 300) || (status.segments >= 200 && status.segments < 300);
    return { available: anyOk, source: 'google_fit', fetchedAt: new Date().toISOString(), window: { startMs: startMs, endMs: endMs }, queryWindow: { startMs: queryStart, endMs: queryEnd }, status: status, sessions: sessions, segments: segments, reason: anyOk ? null : 'GOOGLE_FIT_SLEEP_HISTORY_HTTP_ERROR' };
  } catch (error) { return { available: false, source: 'google_fit', reason: Sensor_safeError_(error), sessions: [], segments: [] }; }
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

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/** Primary Mobvoi provider. Required Script Properties: MOBVOI_API_ENDPOINT and MOBVOI_API_TOKEN. */
function Sensor_Mobvoi_fetchSnapshot(options) {
  var sinceMs = options && typeof options.sinceMs === 'number' ? options.sinceMs : Date.now() - Sensor_HOURS_24_MS;
  try {
    var props = PropertiesService.getScriptProperties(), endpoint = props.getProperty('MOBVOI_API_ENDPOINT'), token = props.getProperty('MOBVOI_API_TOKEN');
    if (!Sensor_isHttpsUrl_(endpoint) || !token || token.length > 4096) return Sensor_unavailableSnapshot('mobvoi', 'MOBVOI_NOT_CONFIGURED', { configuredEndpoint: !!endpoint, configuredToken: !!token });
    var response = UrlFetchApp.fetch(endpoint, { method: 'get', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true, followRedirects: false }), status = response.getResponseCode();
    if (status < 200 || status >= 300) return Sensor_unavailableSnapshot('mobvoi', 'MOBVOI_HTTP_' + status, { httpStatus: status });
    var payload = Sensor_boundedJson_(response.getContentText()), data = Sensor_Mobvoi_normalizePayload_(payload);
    return Sensor_snapshot('mobvoi', sinceMs, data, null, { httpStatus: status, providerTimestamp: Sensor_Mobvoi_timestamp_(payload) });
  } catch (error) { Sensor_logWarning_('[SENSOR] Mobvoi unavailable: ' + Sensor_safeError_(error)); return Sensor_unavailableSnapshot('mobvoi', 'MOBVOI_REQUEST_FAILED', { error: Sensor_safeError_(error) }); }
}
function Sensor_Mobvoi_normalizePayload_(p) { var root = p && typeof p === 'object' ? p : {}, data = root.data && typeof root.data === 'object' ? root.data : root; return { rhrBpm: Sensor_Mobvoi_pick_(data, ['rhrBpm', 'restingHeartRate', 'resting_heart_rate', 'rhr']), sleepMinutes: Sensor_Mobvoi_pick_(data, ['sleepMinutes', 'sleep_minutes', 'totalSleepMinutes', 'sleep_duration_minutes']), steps: Sensor_Mobvoi_pick_(data, ['steps', 'stepCount', 'step_count']) }; }
function Sensor_Mobvoi_pick_(object, keys) { for (var i = 0; i < keys.length; i++) if (Object.prototype.hasOwnProperty.call(object, keys[i])) return object[keys[i]]; return null; }
function Sensor_Mobvoi_timestamp_(payload) { return payload && (payload.timestamp || payload.updatedAt || (payload.data && payload.data.timestamp)) || null; }

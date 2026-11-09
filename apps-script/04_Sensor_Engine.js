/**
 * Sensor entry point. Providers return the Sensor_Snapshot contract declared
 * in sensors/00_Sensor_Contracts.js; callers must treat unavailable data as
 * missing rather than inventing biometric values.
 */
function getBiometricSnapshot() {
  var run = function () {
    var props = PropertiesService.getScriptProperties();
    var provider = String(props.getProperty('BIOOS_SENSOR_PROVIDER') || 'health_connect').trim().toLowerCase();
    var options = { sinceMs: Date.now() - Sensor_HOURS_24_MS };
    if (provider === 'mobvoi') return Sensor_Mobvoi_fetchSnapshot(options);
    if (provider === 'google_fit_legacy') return Sensor_GoogleFit_fetchFallback(options);
    if (provider === 'health_connect') {
      return Sensor_unavailableSnapshot('health_connect', 'HEALTH_CONNECT_ANDROID_BRIDGE_NOT_INSTALLED', { configuredProvider: provider });
    }
    return Sensor_unavailableSnapshot('none', 'SENSOR_PROVIDER_UNSUPPORTED', { configuredProvider: provider });
  };
  try { return typeof executeWithResilience === 'function' ? executeWithResilience('Sensor_Snapshot', run) : run(); }
  catch (error) { Sensor_logWarning_('[SENSOR] Snapshot failed closed: ' + String(error && error.message || error)); return Sensor_unavailableSnapshot('none', 'SENSOR_ENGINE_FAILURE', { error: Sensor_safeError_(error) }); }
}

/* Compatibility shims. New consumers must call getBiometricSnapshot(). */
function _readMobvoiSnapshot_() { return Sensor_Mobvoi_fetchSnapshot({ sinceMs: Date.now() - Sensor_HOURS_24_MS }); }
function _readGoogleFitSnapshot_() { return Sensor_GoogleFit_fetchFallback({ sinceMs: Date.now() - Sensor_HOURS_24_MS }); }

/**
 * Sensor entry point. Providers return the Sensor_Snapshot contract declared
 * in sensors/00_Sensor_Contracts.js; callers must treat unavailable data as
 * missing rather than inventing biometric values.
 */
function getBiometricSnapshot() {
  var run = function () {
    var primary = Sensor_Mobvoi_fetchSnapshot({ sinceMs: Date.now() - Sensor_HOURS_24_MS });
    if (primary.available) return primary;
    var fallback = Sensor_GoogleFit_fetchFallback({ sinceMs: Date.now() - Sensor_HOURS_24_MS });
    fallback.metadata.primaryFailure = primary.reason || null;
    return fallback;
  };
  try { return typeof executeWithResilience === 'function' ? executeWithResilience('Sensor_Snapshot', run) : run(); }
  catch (error) { Sensor_logWarning_('[SENSOR] Snapshot failed closed: ' + String(error && error.message || error)); return Sensor_unavailableSnapshot('none', 'SENSOR_ENGINE_FAILURE', { error: Sensor_safeError_(error) }); }
}

/* Compatibility shims. New consumers must call getBiometricSnapshot(). */
function _readMobvoiSnapshot_() { return Sensor_Mobvoi_fetchSnapshot({ sinceMs: Date.now() - Sensor_HOURS_24_MS }); }
function _readGoogleFitSnapshot_() { return Sensor_GoogleFit_fetchFallback({ sinceMs: Date.now() - Sensor_HOURS_24_MS }); }

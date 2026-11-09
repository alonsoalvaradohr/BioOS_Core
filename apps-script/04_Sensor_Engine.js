/**
 * Sensor entry point. Providers return the Sensor_Snapshot contract declared
 * in sensors/00_Sensor_Contracts.js; callers must treat unavailable data as
 * missing rather than inventing biometric values.
 */
function getBiometricSnapshot() {
  var run = function () {
    var props = PropertiesService.getScriptProperties();
    // Preserve the existing cloud path (Mobvoi/Google Fit) when no explicit provider is configured.
    var provider = String(props.getProperty('BIOOS_SENSOR_PROVIDER') || 'google_fit_legacy').trim().toLowerCase();
    var now = Date.now();
    var options = { sinceMs: Sensor_localDayStartMs_(now), endMs: now };
    if (provider === 'mobvoi') {
      var mobvoi = Sensor_Mobvoi_fetchSnapshot(options);
      return mobvoi && mobvoi.available ? mobvoi : Sensor_GoogleFit_fetchWithFallback_(options, provider, mobvoi);
    }
    if (provider === 'google_fit_legacy') return Sensor_GoogleFit_fetchFallback(options);
    if (provider === 'health_connect') {
      // Mi Fitness may already be syncing into the owner's Google Fit account.
      // Use the existing OAuth path while the direct Health Connect bridge is absent.
      return Sensor_GoogleFit_fetchWithFallback_(options, provider, Sensor_unavailableSnapshot('health_connect', 'HEALTH_CONNECT_ANDROID_BRIDGE_NOT_INSTALLED', { configuredProvider: provider }));
    }
    return Sensor_unavailableSnapshot('none', 'SENSOR_PROVIDER_UNSUPPORTED', { configuredProvider: provider });
  };
  try { return typeof executeWithResilience === 'function' ? executeWithResilience('Sensor_Snapshot', run) : run(); }
  catch (error) { Sensor_logWarning_('[SENSOR] Snapshot failed closed: ' + String(error && error.message || error)); return Sensor_unavailableSnapshot('none', 'SENSOR_ENGINE_FAILURE', { error: Sensor_safeError_(error) }); }
}

function Sensor_GoogleFit_fetchWithFallback_(options, configuredProvider, primarySnapshot) {
  var fit = Sensor_GoogleFit_fetchFallback(options);
  if (fit && fit.available) {
    fit.metadata = fit.metadata || {};
    fit.metadata.configuredProvider = configuredProvider;
    fit.metadata.failoverFrom = primarySnapshot && primarySnapshot.source || configuredProvider;
    return fit;
  }
  if (primarySnapshot) {
    primarySnapshot.metadata = primarySnapshot.metadata || {};
    primarySnapshot.metadata.googleFitFallbackReason = fit && fit.reason || 'GOOGLE_FIT_UNAVAILABLE';
    return primarySnapshot;
  }
  return fit;
}

/* Compatibility shims. New consumers must call getBiometricSnapshot(). */
function _readMobvoiSnapshot_() { var now = Date.now(); return Sensor_Mobvoi_fetchSnapshot({ sinceMs: Sensor_localDayStartMs_(now), endMs: now }); }
function _readGoogleFitSnapshot_() { var now = Date.now(); return Sensor_GoogleFit_fetchFallback({ sinceMs: Sensor_localDayStartMs_(now), endMs: now }); }

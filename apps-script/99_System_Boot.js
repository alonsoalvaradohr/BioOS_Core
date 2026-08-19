/** BioOS v5 boot sequence. This file intentionally contains no daemon code. */
function bootBioOS() {
  return executeWithResilience('System_Boot', () => {
    // Boot is deliberately non-provisioning: it neither creates storage nor
    // changes trigger/webhook state.  Provisioning remains an explicit action.
    const report = preflightDeployment();
    sendSystemTelemetry('SUCCESS', '[BOOT] Preflight aprobado. Meta-Evolve y registro de webhook no se ejecutan desde boot.');
    return { version: report.version, ready: true, preflight: report };
  });
}

function provisionBioOSStorage() {
  return executeWithResilience('System_Provision_Storage', () => {
    const result = initializeMemoryCore();
    sendSystemTelemetry('SUCCESS', '[BOOT] Particiones ausentes provisionadas; datos existentes preservados.');
    return result;
  });
}

/** Alias seguro para configuraciones antiguas: ya no formatea ni borra datos. */
function factoryFormatBioOS() {
  return provisionBioOSStorage();
}

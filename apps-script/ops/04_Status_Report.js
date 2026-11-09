/**
 * Sends an owner-invoked, read-only operational report to the configured
 * Telegram chat. Invoke only through the Apps Script API executable (MYSELF).
 * No raw biometrics, credentials, chat IDs, or preference values are included.
 */
function sendBioOSFullSystemReport() {
  const version = typeof BIOOS_CONFIG !== 'undefined' ? BIOOS_CONFIG.VERSION : 'unknown';
  const checkedAt = new Date().toISOString();
  const memory = typeof getSystemMemory === 'function' ? getSystemMemory() : null;
  const nvram = memory && memory.NVRAM ? memory.NVRAM : {};
  const l1 = nvram.L1_Working && Array.isArray(nvram.L1_Working.session_events) ? nvram.L1_Working.session_events : [];
  const l2 = nvram.L2_Episodic || {};
  const archives = Array.isArray(l2.weekly_archives) ? l2.weekly_archives : [];
  const lake = Array.isArray(l2.raw_data_lake) ? l2.raw_data_lake : [];
  const l3 = nvram.L3_Semantic || {};
  const l4 = nvram.L4_Basal || {};
  const triggers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); }).sort();
  const provider = String(PropertiesService.getScriptProperties().getProperty('BIOOS_SENSOR_PROVIDER') || 'google_fit_legacy').trim().toLowerCase();

  let health = null;
  try { health = typeof healthCheckBioOS === 'function' ? healthCheckBioOS() : null; } catch (error) {}
  const checkSummary = health && Array.isArray(health.checks)
    ? health.checks.map(function(check) { return check.id + ':' + check.status; }).join(' | ')
    : 'No disponible';

  const sensorStatus = provider === 'health_connect'
    ? 'Health Connect seleccionado; se intenta fallback a Google Fit, el informe no consultó sensores.'
    : provider + ' seleccionado; el informe no consultó sensores.';
  const report = [
    '<b>BioOS | Informe de estado</b>',
    'Runtime: <b>' + version + '</b> | lectura: ' + checkedAt,
    'Health check: ' + (health ? (health.healthy ? 'sin FAIL' : 'con FAIL') : 'no disponible') + ' (' + checkSummary + ').',
    '',
    '<b>Arquitectura</b>',
    'Telegram → proxy autenticado → Apps Script doPost → cola/worker → orquestador → NVRAM L0-L4 → Telegram.',
    'Este informe usa Apps Script API con acceso MYSELF; no expone una acción GET pública.',
    '',
    '<b>Memoria durable</b>',
    'Esquema: ' + String(nvram._bioos_memory_schema || 'desconocido') + ' | ROM: ' + String(memory && memory.ROM && memory.ROM._version || 'no disponible') + '.',
    'L1: ' + l1.length + ' eventos | L2: ' + archives.length + ' archivos semanales y ' + lake.length + ' elementos en data lake | L3: ' +
      (Array.isArray(l3.semantic_memories) ? l3.semantic_memories.length : 0) + ' recuerdos vectorizados, ' + (Array.isArray(l3.calibration_deltas) ? l3.calibration_deltas.length : 0) + ' deltas y ' + ((l3.outcome_ledger && Array.isArray(l3.outcome_ledger.records)) ? l3.outcome_ledger.records.length : 0) + ' outcomes confirmados | L4: perfil basal ' +
      (Object.keys(l4).length ? 'presente' : 'ausente') + ', objetivo de sueño ' + (l4.target_sleep_hrs == null ? 'sin dato' : 'configurado') + '.',
    'Se muestran estructura y conteos; no se incluyen biométricos ni preferencias personales.',
    '',
    '<b>Sensores y agenda</b>',
    'Fuente: ' + sensorStatus + ' No se consultó calendario ni se generaron prescripciones.',
    '',
    '<b>Automatización</b>',
    'Triggers activos (' + triggers.length + '): ' + (triggers.join(', ') || 'ninguno') + '.',
    'Las auditorías semanales y la meta-evolución están desprogramadas hasta contar con resultados de entrenamiento confirmados.',
    '',
    '<b>Alcance</b>',
    'El health check revisa configuración, VFS, Sheets, agentes, sensores, triggers y proxy desde Apps Script. No prueba la sincronización del Xiaomi Watch 2 ni es una evaluación médica.'
  ].join('\n');

  const sent = typeof _rawSystemNotify === 'function' && _rawSystemNotify(report);
  return { sent: !!sent, version: version, checkedAt: checkedAt, checkSummary: checkSummary, activeTriggers: triggers.length, reportCharacters: report.length };
}

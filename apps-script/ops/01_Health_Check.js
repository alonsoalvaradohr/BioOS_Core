/**
 * Read-only operational health checks.  These functions deliberately do not
 * call the VFS/repository helpers because those helpers may repair caches or
 * create Sheets.  A preflight must never alter the environment it examines.
 */

function healthCheckBioOS() {
  const startedAt = new Date().toISOString();
  const checks = [
    _opsCheckConfiguration_(),
    _opsCheckSecrets_(),
    _opsCheckVfs_(),
    _opsCheckDatabase_(),
    _opsCheckAgentRegistry_(),
    _opsCheckTriggers_(),
    _opsCheckWebhook_()
  ];
  const failed = checks.filter(function(check) { return check.status === 'FAIL'; });
  const warnings = checks.filter(function(check) { return check.status === 'WARN'; });

  return {
    service: 'BioOS',
    version: (typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG.VERSION) || '5.x',
    checkedAt: startedAt,
    healthy: failed.length === 0,
    readyForDeployment: failed.length === 0 && warnings.length === 0,
    summary: { pass: checks.filter(function(check) { return check.status === 'PASS'; }).length, fail: failed.length, warn: warnings.length },
    checks: checks
  };
}

/**
 * Preflight is intentionally read-only and throws only to stop a release.
 * It is safe to run repeatedly against production.
 */
function preflightDeployment() {
  const report = healthCheckBioOS();
  if (!report.readyForDeployment) {
    const blockers = report.checks.filter(function(check) { return check.status !== 'PASS'; }).map(function(check) {
      return check.id + ': ' + check.message;
    });
    throw new Error('[PREFLIGHT_BLOCKED] ' + blockers.join(' | '));
  }
  return report;
}

function _opsCheckConfiguration_() {
  const required = ['SYS_FLAGS', 'TIMING', 'RESILIENCE', 'MEMORY_LIMITS', 'LOGGING', 'AGENTS'];
  const missing = required.filter(function(key) { return typeof BIOOS_CONFIG === 'undefined' || !BIOOS_CONFIG[key]; });
  return _opsResult_('configuration', missing.length === 0 ? 'PASS' : 'FAIL', missing.length === 0 ? 'Configuración base disponible.' : 'Secciones de configuración ausentes: ' + missing.join(', '));
}

function _opsCheckSecrets_() {
  const props = PropertiesService.getScriptProperties();
  const names = ['GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_SECRET_TOKEN'];
  const missing = names.filter(function(name) { return !props.getProperty(name); });
  return _opsResult_('secrets', missing.length === 0 ? 'PASS' : 'FAIL', missing.length === 0 ? 'Secretos requeridos presentes.' : 'Script Properties ausentes: ' + missing.join(', '), { checked: names });
}

function _opsCheckVfs_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const folderId = props.getProperty('VFS_FOLDER_ID');
    const romId = props.getProperty('VFS_ROM_ID');
    const nvramId = props.getProperty('VFS_NVRAM_ID');
    let folder;
    let romFile;
    let nvramFile;
    if (folderId && romId && nvramId) {
      folder = DriveApp.getFolderById(folderId);
      romFile = DriveApp.getFileById(romId);
      nvramFile = DriveApp.getFileById(nvramId);
    } else {
      const folders = DriveApp.getFoldersByName('BioOS_Core');
      if (!folders.hasNext()) return _opsResult_('vfs', 'FAIL', 'Carpeta BioOS_Core no encontrada.');
      folder = folders.next();
      const romFiles = folder.searchFiles("title = 'BioOS_ROM.json' and trashed = false");
      const nvramFiles = folder.searchFiles("title = 'BioOS_NVRAM.json' and trashed = false");
      if (!romFiles.hasNext() || !nvramFiles.hasNext()) return _opsResult_('vfs', 'FAIL', 'ROM o NVRAM no encontrados en BioOS_Core.');
      romFile = romFiles.next();
      nvramFile = nvramFiles.next();
    }
    const rom = JSON.parse(romFile.getBlob().getDataAsString());
    const nvram = JSON.parse(nvramFile.getBlob().getDataAsString());
    const partitions = ['L0_Ingestion_Cursors', 'L1_Working', 'L2_Episodic', 'L3_Semantic', 'L4_Basal'];
    const missing = partitions.filter(function(key) { return !nvram[key]; });
    if (!rom || !rom._version || missing.length) return _opsResult_('vfs', 'FAIL', 'Estructura VFS inválida; particiones ausentes: ' + missing.join(', '));
    return _opsResult_('vfs', 'PASS', 'ROM/NVRAM legibles y con particiones L0-L4.', { folderId: folder.getId(), romId: romFile.getId(), nvramId: nvramFile.getId(), romVersion: rom._version });
  } catch (error) {
    return _opsResult_('vfs', 'FAIL', 'VFS inaccesible o corrupto: ' + _opsSafeError_(error));
  }
}

function _opsCheckDatabase_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const configuredId = props.getProperty('BIOOS_DB_ID');
    let spreadsheet;
    if (configuredId) {
      spreadsheet = SpreadsheetApp.openById(configuredId);
    } else {
      const files = DriveApp.searchFiles("title = 'BioOS_Database' and trashed = false");
      if (!files.hasNext()) return _opsResult_('database', 'FAIL', 'BioOS_Database no encontrada.');
      spreadsheet = SpreadsheetApp.openById(files.next().getId());
    }
    const queue = spreadsheet.getSheetByName('Queue_NLP');
    if (!queue) return _opsResult_('database', 'FAIL', 'Hoja Queue_NLP ausente; preflight no la creará.');
    return _opsResult_('database', 'PASS', 'Repositorio disponible en modo lectura.', { spreadsheetId: spreadsheet.getId(), queueRows: queue.getLastRow() });
  } catch (error) {
    return _opsResult_('database', 'FAIL', 'Repositorio inaccesible: ' + _opsSafeError_(error));
  }
}

function _opsCheckTriggers_() {
  try {
    const handlers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
    const managed = ['triggerMorningBriefing', 'triggerEveningBriefing', 'workerProcessNLP', 'triggerMetaEvolution'];
    const duplicates = managed.filter(function(handler) { return handlers.filter(function(value) { return value === handler; }).length > 1; });
    if (handlers.indexOf('triggerMetaEvolution') !== -1) return _opsResult_('triggers', 'FAIL', 'Trigger Meta-Evolve prohibido activo.', { handlers: handlers });
    if (duplicates.length) return _opsResult_('triggers', 'FAIL', 'Triggers duplicados: ' + duplicates.join(', '), { handlers: handlers });
    return _opsResult_('triggers', 'PASS', 'Topología de triggers sin duplicados ni Meta-Evolve.', { handlers: handlers });
  } catch (error) {
    return _opsResult_('triggers', 'FAIL', 'No fue posible inspeccionar triggers: ' + _opsSafeError_(error));
  }
}

function _opsCheckAgentRegistry_() {
  if (typeof validateAgentRegistry !== 'function' || typeof getAgentRegistry !== 'function') {
    return _opsResult_('agentRegistry', 'FAIL', 'Agent Registry declarativo no está disponible.');
  }
  const registryCheck = validateAgentRegistry();
  if (!registryCheck.ok) return _opsResult_('agentRegistry', 'FAIL', registryCheck.errors.join(' | '));
  try {
    const vfs = _opsReadRomForRegistry_();
    const prompts = (vfs.agent_prompts || {});
    const missing = Object.keys(getAgentRegistry()).filter(function(agentId) { return !String(prompts[agentId] || '').trim(); });
    return missing.length ? _opsResult_('agentRegistry', 'WARN', 'Agentes registrados sin prompt ROM aprobado: ' + missing.join(', '), { missingPrompts: missing }) : _opsResult_('agentRegistry', 'PASS', 'Registro y prompts ROM completos.');
  } catch (error) {
    return _opsResult_('agentRegistry', 'FAIL', 'No se pudo comparar el registro con ROM: ' + _opsSafeError_(error));
  }
}

function _opsReadRomForRegistry_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('VFS_ROM_ID');
  if (cached) return JSON.parse(DriveApp.getFileById(cached).getBlob().getDataAsString());
  const folders = DriveApp.getFoldersByName('BioOS_Core');
  if (!folders.hasNext()) throw new Error('BioOS_Core no encontrada.');
  const files = folders.next().searchFiles("title = 'BioOS_ROM.json' and trashed = false");
  if (!files.hasNext()) throw new Error('BioOS_ROM.json no encontrado.');
  return JSON.parse(files.next().getBlob().getDataAsString());
}

function _opsCheckWebhook_() {
  const props = PropertiesService.getScriptProperties();
  const webAppUrl = props.getProperty('BIOOS_WEB_APP_URL');
  const secret = props.getProperty('TELEGRAM_SECRET_TOKEN');
  const urlValid = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\/?$/i.test(String(webAppUrl || ''));
  if (!urlValid) return _opsResult_('webhook', 'FAIL', 'BIOOS_WEB_APP_URL debe apuntar al proxy HTTPS autenticado en workers.dev; GAS directo queda cerrado.');
  if (!secret) return _opsResult_('webhook', 'FAIL', 'TELEGRAM_SECRET_TOKEN ausente.');
  return _opsResult_('webhook', 'PASS', 'Proxy y secreto configurados; el estado remoto de Telegram se valida mediante smoke test separado.', { urlConfigured: true, proxyRequired: true });
}

function _opsResult_(id, status, message, details) {
  return { id: id, status: status, message: message, details: details || {} };
}

function _opsSafeError_(error) {
  return String(error && error.message ? error.message : error).replace(/[\r\n]+/g, ' ').substring(0, 300);
}

/**
 * Explicit, approval-gated runtime maintenance. No trigger or model may call
 * these entry points. Read-only status is the sole unauthenticated operation.
 */
var OPS_APPROVAL_PROPERTY_ = 'BIOOS_OPS_APPROVAL_TOKEN';
var OPS_MANAGED_TRIGGERS_ = ['triggerNightIngest', 'triggerMorningBriefing', 'triggerEveningIngest', 'triggerEveningBriefing', 'workerProcessNLP', 'triggerMetaEvolution'];

function _opsConstantTimeEquals_(expected, actual) {
  expected = String(expected || ''); actual = String(actual || '');
  var mismatch = expected.length ^ actual.length;
  var length = Math.max(expected.length, actual.length);
  for (var i = 0; i < length; i++) mismatch |= (expected.charCodeAt(i % Math.max(1, expected.length)) || 0) ^ (actual.charCodeAt(i % Math.max(1, actual.length)) || 0);
  return mismatch === 0;
}

function _opsRequireApprovalToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty(OPS_APPROVAL_PROPERTY_);
  if (!expected || expected.length < 24) throw new Error('[OPS_APPROVAL_BLOCKED] Configure BIOOS_OPS_APPROVAL_TOKEN (mínimo 24 caracteres).');
  if (!_opsConstantTimeEquals_(expected, token)) throw new Error('[OPS_APPROVAL_BLOCKED] Token de aprobación inválido.');
}

function getRuntimeStateSummary() {
  var vfs = _getVfsNodes(), rom = JSON.parse(vfs.romFile.getBlob().getDataAsString()) || {}, nvram = JSON.parse(vfs.nvramFile.getBlob().getDataAsString()) || {};
  var prompts = rom.agent_prompts || {}, registry = typeof getAgentRegistry === 'function' ? getAgentRegistry() : {};
  var missing = Object.keys(registry).filter(function(id) { return !String(prompts[id] || '').trim(); });
  return {
    configVersion: BIOOS_CONFIG.VERSION,
    romVersion: rom._version || 'UNKNOWN',
    memorySchema: Number(nvram._bioos_memory_schema || 0),
    promptIds: Object.keys(prompts).sort(),
    missingPrompts: missing,
    counts: {
      l1Events: (((nvram.L1_Working || {}).session_events) || []).length,
      l2Archives: (((nvram.L2_Episodic || {}).weekly_archives) || []).length,
      l2RawLake: (((nvram.L2_Episodic || {}).raw_data_lake) || []).length
    },
    capabilities: BIOOS_CONFIG.CAPABILITIES
  };
}

function migrateNVRAMToCurrentSchema(approvalToken) {
  _opsRequireApprovalToken_(approvalToken);
  var state = mutateNVRAM(function(current) { return current; }, 'Ops_Migrate_NVRAM');
  return { migrated: true, memorySchema: state._bioos_memory_schema, counts: { l1Events: state.L1_Working.session_events.length, l2Archives: state.L2_Episodic.weekly_archives.length, l2RawLake: state.L2_Episodic.raw_data_lake.length } };
}

function installCanonicalV5Prompts(approvalToken) {
  _opsRequireApprovalToken_(approvalToken);
  var canonical = {
    ejecutivo: 'Eres el agente ejecutivo de BioOS. Convierte únicamente conclusiones auditadas en un plan breve, reversible y no clínico. No ejecutes acciones externas ni inventes datos.',
    endocrinologo: 'Eres el especialista metabólico de BioOS. Formula hipótesis prudentes sobre energía, nutrición y recuperación usando solo datos con procedencia. No diagnostiques ni prescribas; declara incertidumbre y señales de derivación profesional.',
    psicologo_cog: 'Eres el especialista cognitivo de BioOS. Evalúa carga, fatiga y contexto emocional sin diagnosticar. Prioriza privacidad, lenguaje no coercitivo, una sola pregunta si es indispensable y recomendaciones reversibles.'
  };
  return executeWithResilience('Ops_Install_Canonical_Prompts', function() { return executeWithMutex('SCRIPT', function() {
    var vfs = _getVfsNodes(), rom = JSON.parse(vfs.romFile.getBlob().getDataAsString());
    if (!rom.agent_prompts || typeof rom.agent_prompts !== 'object') rom.agent_prompts = {};
    var missing = Object.keys(canonical).filter(function(id) { return !String(rom.agent_prompts[id] || '').trim(); });
    if (!missing.length) return { changed: false, installed: [], romVersion: rom._version };
    var review = _metaReviewFolder(vfs), snapshotId = 'rom_before_ops_prompts_' + new Date().getTime(), before = _metaClone(rom);
    _metaWriteJson(review, snapshotId + '.json', { kind: 'BIOOS_ROM_SNAPSHOT', snapshotId: snapshotId, createdAt: new Date().toISOString(), operation: 'INSTALL_CANONICAL_V5_PROMPTS', rom: before, checksum: _metaSha256(JSON.stringify(before)) });
    missing.forEach(function(id) { rom.agent_prompts[id] = canonical[id]; });
    rom._version = '5.1.0-runtime+' + new Date().getTime();
    vfs.romFile.setContent(JSON.stringify(rom));
    var verified = JSON.parse(vfs.romFile.getBlob().getDataAsString());
    missing.forEach(function(id) { if (verified.agent_prompts[id] !== canonical[id]) throw new Error('[OPS_ABORT] Verificación ROM falló para ' + id + '; snapshot=' + snapshotId); });
    return { changed: true, installed: missing, snapshotId: snapshotId, romVersion: verified._version };
  }); });
}

function emergencyStopManagedTriggers(approvalToken) {
  _opsRequireApprovalToken_(approvalToken);
  var removed = [];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (OPS_MANAGED_TRIGGERS_.indexOf(handler) !== -1) { ScriptApp.deleteTrigger(trigger); removed.push(handler); }
  });
  return { stopped: true, removed: removed, queuePurged: false };
}

function emergencyPurgeQueue(approvalToken, confirmation) {
  _opsRequireApprovalToken_(approvalToken);
  if (confirmation !== 'PURGE_QUEUE') throw new Error('[OPS_CONFIRMATION_REQUIRED] confirmation debe ser PURGE_QUEUE.');
  if (typeof repoEmergencyPurgeQueue !== 'function') throw new Error('[OPS_UNAVAILABLE] Repositorio de cola no disponible.');
  return { purged: true, removedJobs: repoEmergencyPurgeQueue() };
}
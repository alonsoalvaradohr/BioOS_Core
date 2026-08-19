/** Durable NVRAM store: plaintext primary plus two checksummed recovery slots. */
var MEM_SCHEMA_VERSION = 2;
var MEM_SLOT_NAMES = { A: 'BioOS_NVRAM.slotA.json', B: 'BioOS_NVRAM.slotB.json' };
var MEM_LIMITS = { L1_EVENTS: 10, L2_ARCHIVES: 52, L2_DATA_LAKE: 250, MAX_SERIALIZED_BYTES: 1500000 };

function executeWithMutex(lockType, taskFunction) {
  var lock = lockType === 'SCRIPT' ? LockService.getScriptLock() : LockService.getUserLock(), acquired = false;
  try { lock.waitLock(BIOOS_CONFIG.TIMING.MUTEX_LOCK_TIMEOUT_MS); acquired = true; } catch (e) { throw new Error('[MUTEX_TIMEOUT] Contención de memoria: ' + e.message); }
  try { return taskFunction(); } finally { if (acquired) lock.releaseLock(); }
}
function _getVfsNodes() {
  var p = PropertiesService.getScriptProperties(), folderId = p.getProperty('VFS_FOLDER_ID'), romId = p.getProperty('VFS_ROM_ID'), nvramId = p.getProperty('VFS_NVRAM_ID');
  if (folderId && romId && nvramId) try { return { folder: DriveApp.getFolderById(folderId), romFile: DriveApp.getFileById(romId), nvramFile: DriveApp.getFileById(nvramId) }; } catch (e) { p.deleteProperty('VFS_FOLDER_ID'); p.deleteProperty('VFS_ROM_ID'); p.deleteProperty('VFS_NVRAM_ID'); }
  var folders = DriveApp.getFoldersByName('BioOS_Core'); if (!folders.hasNext()) throw new Error('[VFS_PANIC] Volumen BioOS_Core no existe.');
  var folder = folders.next(), roms = folder.searchFiles("title = 'BioOS_ROM.json' and trashed = false"), nvrams = folder.searchFiles("title = 'BioOS_NVRAM.json' and trashed = false");
  if (!roms.hasNext() || !nvrams.hasNext()) throw new Error('[VFS_PANIC] ROM/NVRAM inaccesibles.');
  var result = { folder: folder, romFile: roms.next(), nvramFile: nvrams.next() }; p.setProperty('VFS_FOLDER_ID', folder.getId()); p.setProperty('VFS_ROM_ID', result.romFile.getId()); p.setProperty('VFS_NVRAM_ID', result.nvramFile.getId()); return result;
}
function _memClone(v) { return JSON.parse(JSON.stringify(v)); }
/* FNV-1a integrity check; this is not a cryptographic signature. */
function _memChecksum(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); } return ('00000000' + (h >>> 0).toString(16)).slice(-8); }
function _memDefaultState() { return { L0_Ingestion_Cursors: { last_sync_ms: new Date().getTime() - 86400000 }, L1_Working: { session_events: [], context_anxiety_flag: false }, L2_Episodic: { weekly_archives: [], raw_data_lake: [] }, L3_Semantic: { medical_knowledge_graph: { lesiones_activas: [], tendencias_metabolicas: [] } }, L4_Basal: { baseline_rhr: BIOOS_CONFIG.BIOMETRY.BASELINE_RHR, target_steps: BIOOS_CONFIG.BIOMETRY.TARGET_STEPS } }; }
/** Adds missing schema fields only; it never resets existing partitions. */
function _memMigrateNVRAM(input) {
  var s = input && typeof input === 'object' ? _memClone(input) : {}, d = _memDefaultState();
  ['L0_Ingestion_Cursors', 'L1_Working', 'L2_Episodic', 'L3_Semantic', 'L4_Basal'].forEach(function (k) { if (!s[k] || typeof s[k] !== 'object') s[k] = d[k]; });
  if (!Array.isArray(s.L1_Working.session_events)) s.L1_Working.session_events = [];
  if (!Array.isArray(s.L2_Episodic.weekly_archives)) s.L2_Episodic.weekly_archives = [];
  if (!Array.isArray(s.L2_Episodic.raw_data_lake)) s.L2_Episodic.raw_data_lake = [];
  if (!s.L3_Semantic.medical_knowledge_graph || typeof s.L3_Semantic.medical_knowledge_graph !== 'object') s.L3_Semantic.medical_knowledge_graph = d.L3_Semantic.medical_knowledge_graph;
  if (typeof s.L0_Ingestion_Cursors.last_sync_ms !== 'number') s.L0_Ingestion_Cursors.last_sync_ms = d.L0_Ingestion_Cursors.last_sync_ms;
  s._bioos_memory_schema = MEM_SCHEMA_VERSION; return s;
}
function _memApplyHardLimits(s) {
  s.L1_Working.session_events = s.L1_Working.session_events.slice(-MEM_LIMITS.L1_EVENTS);
  s.L2_Episodic.weekly_archives = s.L2_Episodic.weekly_archives.slice(-MEM_LIMITS.L2_ARCHIVES);
  s.L2_Episodic.raw_data_lake = s.L2_Episodic.raw_data_lake.slice(-MEM_LIMITS.L2_DATA_LAKE);
  s.L1_Working.context_anxiety_flag = s.L1_Working.session_events.length >= Math.ceil(MEM_LIMITS.L1_EVENTS * BIOOS_CONFIG.MEMORY_LIMITS.COMPACTION_THRESHOLD_PCT); return s;
}
function _validateNVRAMState(n) { var state = _memApplyHardLimits(_memMigrateNVRAM(n)), json = JSON.stringify(state); if (json.length > MEM_LIMITS.MAX_SERIALIZED_BYTES) throw new Error('[MEMORY_LIMIT] NVRAM excede el límite serializado.'); JSON.parse(json); return { state: state, json: json }; }
function _memCreateEnvelope(state, generation) { var x = _validateNVRAMState(state); return { format: 'BioOS-NVRAM-Recovery', schemaVersion: MEM_SCHEMA_VERSION, generation: generation, committedAt: new Date().toISOString(), checksum: _memChecksum(x.json), state: x.state }; }
function _memValidateEnvelope(e) { if (!e || e.format !== 'BioOS-NVRAM-Recovery' || typeof e.generation !== 'number' || !e.state) throw new Error('[VFS_RECOVERY_INVALID] Envelope inválido.'); var x = _validateNVRAMState(e.state); if (_memChecksum(x.json) !== e.checksum) throw new Error('[VFS_RECOVERY_INVALID] Checksum no coincide.'); return { state: x.state, json: x.json, generation: e.generation }; }
function _memFindFile(folder, title) { var fs = folder.searchFiles("title = '" + title + "' and trashed = false"); return fs.hasNext() ? fs.next() : null; }
function _memWriteSlot(folder, name, envelope) { var f = _memFindFile(folder, name) || folder.createFile(name, '', MimeType.PLAIN_TEXT); f.setContent(JSON.stringify(envelope)); return _memValidateEnvelope(JSON.parse(f.getBlob().getDataAsString())); }
function _memReadSlot(folder, name) { var f = _memFindFile(folder, name); if (!f) return null; try { return _memValidateEnvelope(JSON.parse(f.getBlob().getDataAsString())); } catch (e) { return null; } }
function _memReadPrimary(vfs) { var raw = vfs.nvramFile.getBlob().getDataAsString(), parsed; try { parsed = JSON.parse(raw); } catch (e) { throw new Error('[VFS_CORRUPTION] NVRAM JSON inválida; ejecute inspectNVRAMRecovery() y repairNVRAMFromRecoverySlot(slot).'); } return _validateNVRAMState(parsed); }
function _memActiveRecovery(p, folder) { var active = p.getProperty('VFS_NVRAM_ACTIVE_SLOT'); return active === 'A' || active === 'B' ? _memReadSlot(folder, MEM_SLOT_NAMES[active]) : null; }

/** Read-only recovery diagnosis. It intentionally never repairs state. */
function inspectNVRAMRecovery() { return executeWithResilience('Mem_Inspect_Recovery', function () { return executeWithMutex('SCRIPT', function () { var v = _getVfsNodes(), p = PropertiesService.getScriptProperties(), primary; try { primary = _memReadPrimary(v); } catch (e) { primary = { error: e.message }; } var a = _memReadSlot(v.folder, MEM_SLOT_NAMES.A), b = _memReadSlot(v.folder, MEM_SLOT_NAMES.B), activeName = p.getProperty('VFS_NVRAM_ACTIVE_SLOT'), active = activeName === 'A' ? a : activeName === 'B' ? b : null, matching = !!(primary.json && active && _memChecksum(primary.json) === _memChecksum(active.json)); return { primaryValid: !primary.error, activeSlot: activeName || null, activeGeneration: active ? active.generation : null, primaryMatchesActive: matching, slots: { A: a ? { valid: true, generation: a.generation } : { valid: false }, B: b ? { valid: true, generation: b.generation } : { valid: false } }, repairRequired: !!(primary.error || (activeName && !matching)) }; }); }); }
/** Explicit operator action; no normal read path calls this. */
function repairNVRAMFromRecoverySlot(slot) { if (slot !== 'A' && slot !== 'B') throw new Error('[VFS_RECOVERY_ABORT] Slot debe ser A o B.'); return executeWithResilience('Mem_Explicit_Recovery', function () { return executeWithMutex('SCRIPT', function () { var v = _getVfsNodes(), p = PropertiesService.getScriptProperties(), recovery = _memReadSlot(v.folder, MEM_SLOT_NAMES[slot]); if (!recovery) throw new Error('[VFS_RECOVERY_ABORT] Slot no verificable.'); v.nvramFile.setContent(recovery.json); if (_memChecksum(_memReadPrimary(v).json) !== _memChecksum(recovery.json)) throw new Error('[VFS_RECOVERY_ABORT] Verificación posterior falló.'); p.setProperty('VFS_NVRAM_ACTIVE_SLOT', slot); return { repaired: true, slot: slot, generation: recovery.generation }; }); }); }
function getSystemMemory() { return executeWithResilience('Mem_Read_Core', function () { return executeWithMutex('SCRIPT', function () { var v = _getVfsNodes(), p = PropertiesService.getScriptProperties(), nvram = _memReadPrimary(v), activeName = p.getProperty('VFS_NVRAM_ACTIVE_SLOT'), active = _memActiveRecovery(p, v.folder); if (activeName && (!active || _memChecksum(nvram.json) !== _memChecksum(active.json))) throw new Error('[VFS_RECOVERY_REQUIRED] NVRAM no coincide con commit verificado; recuperación explícita requerida.'); return { ROM: JSON.parse(v.romFile.getBlob().getDataAsString()), NVRAM: nvram.state }; }); }); }
function mutateNVRAM(mutator, operationName) { if (typeof mutator !== 'function') throw new Error('[ACID_ABORT] mutateNVRAM requiere un mutator.'); return executeWithResilience(operationName || 'Mem_Mutate_NVRAM', function () { return executeWithMutex('SCRIPT', function () { var v = _getVfsNodes(), p = PropertiesService.getScriptProperties(), current = _memReadPrimary(v), activeName = p.getProperty('VFS_NVRAM_ACTIVE_SLOT'), active = _memActiveRecovery(p, v.folder); if (activeName && (!active || _memChecksum(current.json) !== _memChecksum(active.json))) throw new Error('[VFS_RECOVERY_REQUIRED] Commit ambiguo; mutación bloqueada.'); var draft = _memClone(current.state), result = mutator(draft); if (result !== undefined) draft = result; var gen = active ? active.generation + 1 : 1, envelope = _memCreateEnvelope(draft, gen), next = activeName === 'A' ? 'B' : 'A'; _memWriteSlot(v.folder, MEM_SLOT_NAMES[next], envelope); v.nvramFile.setContent(JSON.stringify(envelope.state)); if (_memChecksum(_memReadPrimary(v).json) !== envelope.checksum) throw new Error('[ACID_ABORT] Primario no verificable; slot de recuperación disponible.'); p.setProperty('VFS_NVRAM_ACTIVE_SLOT', next); return envelope.state; }); }); }
function commitNVRAM(newState) { var replacement = _memClone(newState); mutateNVRAM(function () { return replacement; }, 'Mem_Write_NVRAM'); return true; }
function ingestWorkingMemory(origin, tokens) { return mutateNVRAM(function (s) { s.L1_Working.session_events.push({ timestamp: new Date().toISOString(), origin: origin, data: tokens }); }, 'Mem_Ingest_L1').L1_Working.context_anxiety_flag; }
function ingestToDataLake(dataType, rawPayload) { mutateNVRAM(function (s) { s.L2_Episodic.raw_data_lake.push({ timestamp: new Date().toISOString(), data_type: dataType, payload: rawPayload }); }, 'Mem_Ingest_DataLake'); return true; }
function getIngestionCursor() { return getSystemMemory().NVRAM.L0_Ingestion_Cursors.last_sync_ms; }
function updateIngestionCursor(ms) { mutateNVRAM(function (s) { s.L0_Ingestion_Cursors.last_sync_ms = ms; }, 'Mem_Write_Cursor'); return true; }
function initializeMemoryCore() { return executeWithResilience('Mem_Format_Partitions', function () { return executeWithMutex('SCRIPT', function () { var p = PropertiesService.getScriptProperties(); p.deleteProperty('VFS_FOLDER_ID'); p.deleteProperty('VFS_ROM_ID'); p.deleteProperty('VFS_NVRAM_ID'); var fs = DriveApp.getFoldersByName('BioOS_Core'), folder = fs.hasNext() ? fs.next() : DriveApp.createFolder('BioOS_Core'); if (!_memFindFile(folder, 'BioOS_ROM.json')) folder.createFile('BioOS_ROM.json', JSON.stringify({ _version: '5.0.0-Autonomous-Cognitive-Kernel', _safety_invariants: ['No prescripción clínica severa.'], agent_prompts: {}, _cache_control: 'STATIC_BYTE_LOCKED' }), MimeType.PLAIN_TEXT); if (!_memFindFile(folder, 'BioOS_NVRAM.json')) folder.createFile('BioOS_NVRAM.json', JSON.stringify(_memDefaultState()), MimeType.PLAIN_TEXT); return true; }); }); }

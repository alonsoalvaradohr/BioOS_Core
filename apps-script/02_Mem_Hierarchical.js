/** Durable NVRAM store: plaintext primary plus two checksummed recovery slots. */
var MEM_SCHEMA_VERSION = 2;
var MEM_SLOT_NAMES = { A: 'BioOS_NVRAM.slotA.json', B: 'BioOS_NVRAM.slotB.json' };
var MEM_LIMITS = { L1_EVENTS: 10, L2_ARCHIVES: 52, L2_DATA_LAKE: 250, SEMANTIC_MEMORIES: 300, MAX_SERIALIZED_BYTES: 4000000 };
var MEMORY_VECTOR_VERSION = 'bioos-es-hashvec-v1';
var MEMORY_VECTOR_DIMENSIONS = 96;

// IDs canónicos predeterminados para evitar búsquedas lentas de Drive
var _DEFAULT_VFS_ROM_ID = '17u0ZOqejUTXbS8CO4DJ8ZttX7umOEIwI';
var _DEFAULT_VFS_NVRAM_ID = '1AYevqFlhNNdT3j1h-HHSTqwyQEZ3S-7a';

// Caché en RAM volátil durante la ejecución del hilo
var _VFS_IN_MEMORY_CACHE = null;
var _VFS_NODES_CACHE = null;

function executeWithMutex(lockType, taskFunction) {
  var lock = lockType === 'SCRIPT' ? LockService.getScriptLock() : LockService.getUserLock(), acquired = false;
  try { lock.waitLock(BIOOS_CONFIG.TIMING.MUTEX_LOCK_TIMEOUT_MS); acquired = true; } catch (e) { throw new Error('[MUTEX_TIMEOUT] Contención de memoria: ' + e.message); }
  try { return taskFunction(); } finally { if (acquired) lock.releaseLock(); }
}

function _getVfsNodes() {
  if (_VFS_NODES_CACHE && _VFS_NODES_CACHE.romFile && _VFS_NODES_CACHE.nvramFile) {
    return _VFS_NODES_CACHE;
  }
  var p = PropertiesService.getScriptProperties();
  var folderId = p.getProperty('VFS_FOLDER_ID');
  var romId = p.getProperty('VFS_ROM_ID') || _DEFAULT_VFS_ROM_ID;
  var nvramId = p.getProperty('VFS_NVRAM_ID') || _DEFAULT_VFS_NVRAM_ID;

  var romFile = null, nvramFile = null, folder = null;

  // Intento 1: Acceso directo por ID
  try {
    romFile = DriveApp.getFileById(romId);
    nvramFile = DriveApp.getFileById(nvramId);
    if (folderId) {
      try { folder = DriveApp.getFolderById(folderId); } catch (_) {}
    }
  } catch (e) {
    console.warn('[VFS_WARN] IDs directos no accesibles, buscando volumen BioOS_Core...');
  }

  // Intento 2: Búsqueda por carpeta si falló el acceso directo
  if (!romFile || !nvramFile) {
    var folders = DriveApp.getFoldersByName('BioOS_Core');
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('BioOS_Core');
    var roms = folder.searchFiles("title = 'BioOS_ROM.json' and trashed = false");
    var nvrams = folder.searchFiles("title = 'BioOS_NVRAM.json' and trashed = false");
    var defaultRom = {
      _version: '5.2.0-MultiAgent-ActiveInference',
      _safety_invariants: [
        'Prohibido recetar medicación clínica o farmacología.',
        'Priorizar la recuperación central (SNC) sobre el volumen de entrenamiento periférico.',
        'Cualquier inferencia debe cruzarse con telemetría real o declarar explícitamente ceguera sensorial.',
        'Si faltan datos matemáticos vitales (SENSOR_OFFLINE), está prohibido adivinarlos o interpolar números; se debe solicitar feedback puntual al usuario.'
      ],
      agent_prompts: {
        orquestador: "Eres el Orquestador y Coprocesador Asíncrono de Inferencia Activa de BioOS v5.2. Tu usuario es Ingeniero y Líder de I+D en robótica/automatización con alta carga de running de fondo. VETO DE HIERRO: Cero cortesía vacía ('buenos días', 'espero que estés bien'), cero recomendaciones genéricas ('toma luz solar', 'camina un poco', '¿tienes espacio?'). Directo a la acción táctica procesable, lenguaje técnico sobrio, alta densidad semántica.",
        fisiologo: "Eres el Fisiólogo y Running Coach de BioOS v5.2. Evalúas la recuperación del SNC (RHR basal 43 bpm vs actual), fatiga neuromuscular y biomecánica de carrera. Prescribes sesiones exactas con parámetros numéricos rigurosos (ej. 'Tirada 8 km en Z2 a 5:15/km, cadencia 175-180 ppm' o 'Descanso total por desacoplamiento cardiovascular'). Propones tareas ejecutivas para recuperación articular y estiramientos.",
        somnologo: "Eres el Cronobiólogo y Especialista en Sueño de BioOS v5.2. Analizas la arquitectura del descanso (horas reales vs meta 7.3h, latencia, regularidad circadiana). Fijas la ventana de sueño óptima (sleep_window), indicando la hora exacta de atenuación lumínica y la hora meta de apagado para proteger la cognición en I+D.",
        endocrinologo: "Eres el Especialista en Nutrición y Bioenergética de BioOS v5.2. Dictas prescripciones dietéticas cuantitativas según el esfuerzo del día (g/kg de carbohidratos, gramos de proteína, hidratación en ml y electrolitos). Al recibir fotos o texto de comidas, estimas el balance calórico vs gasto del running y ajustas el timing de comidas.",
        ejecutivo: "Eres el Ejecutivo de Workspace de BioOS v5.2. Cruzas Google Calendar y Google Tasks. Filtras la carga cognitiva, alineas entregables técnicos de robótica/CAD y generas tareas directas sin fricción ni confirmaciones innecesarias.",
        psicologo_cog: "Eres el Psicólogo Cognitivo de BioOS v5.2. Modulas la carga alostática, previenes la fatiga de decisión durante bloques de trabajo profundo y recomiendas protocolos breves de desconexión.",
        auditor: "Eres el Agente Auditor (SPADE). Verificas que ninguna intervención propuesta viole los _safety_invariants ni contenga alucinaciones numéricas."
      },
      _cache_control: 'STATIC_BYTE_LOCKED'
    };
    romFile = roms.hasNext() ? roms.next() : folder.createFile('BioOS_ROM.json', JSON.stringify(defaultRom), MimeType.PLAIN_TEXT);
    nvramFile = nvrams.hasNext() ? nvrams.next() : folder.createFile('BioOS_NVRAM.json', JSON.stringify(_memDefaultState()), MimeType.PLAIN_TEXT);
  }

  var result = { folder: folder, romFile: romFile, nvramFile: nvramFile };
  if (folder) p.setProperty('VFS_FOLDER_ID', folder.getId());
  p.setProperty('VFS_ROM_ID', romFile.getId());
  p.setProperty('VFS_NVRAM_ID', nvramFile.getId());
  _VFS_NODES_CACHE = result;
  return result;
}

function _memClone(v) { return JSON.parse(JSON.stringify(v)); }
function _memUtf8ByteLength_(text) { return unescape(encodeURIComponent(String(text))).length; }
/* FNV-1a integrity check; this is not a cryptographic signature. */
function _memChecksum(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); } return ('00000000' + (h >>> 0).toString(16)).slice(-8); }
function _memDefaultState() {
  return {
    L0_Ingestion_Cursors: { last_sync_ms: new Date().getTime() - 86400000 },
    L1_Working: { session_events: [], context_anxiety_flag: false },
    L2_Episodic: { weekly_archives: [], raw_data_lake: [] },
    L3_Semantic: {
      medical_knowledge_graph: { lesiones_activas: [], tendencias_metabolicas: [] },
      evolutionary_weights: { running_intensity_tolerance: 1.0, recovery_speed_factor: 1.0, task_completion_bias: 1.0 },
      calibration_deltas: [],
      semantic_memories: [],
      outcome_ledger: { schemaVersion: 1, records: [] }
    },
    L4_Basal: {
      baseline_rhr: BIOOS_CONFIG.BIOMETRY.BASELINE_RHR || 43,
      target_steps: BIOOS_CONFIG.BIOMETRY.TARGET_STEPS || 8000,
      target_sleep_hrs: 7.3,
      user_preferences_vector: { quiet_hours: [8, 17], preferred_run_time: '05:00', high_protein_bias: true }
    }
  };
}

function _memSanitizeItem(item, maxLen) {
  if (typeof item === 'string') return item.length > (maxLen || 800) ? item.substring(0, maxLen || 800) + '...[TRUNCATED]' : item;
  if (item && typeof item === 'object') {
    if (Array.isArray(item)) return item.map(function(sub) { return _memSanitizeItem(sub, maxLen); });
    var clean = {};
    for (var k in item) {
      if (Object.prototype.hasOwnProperty.call(item, k)) {
        clean[k] = _memSanitizeItem(item[k], maxLen);
      }
    }
    return clean;
  }
  return item;
}

/** Adds missing schema fields only; it never resets existing partitions. */
function _memMigrateNVRAM(input) {
  var s = input && typeof input === 'object' ? _memClone(input) : {}, d = _memDefaultState();
  ['L0_Ingestion_Cursors', 'L1_Working', 'L2_Episodic', 'L3_Semantic', 'L4_Basal'].forEach(function (k) { if (!s[k] || typeof s[k] !== 'object') s[k] = d[k]; });
  if (!Array.isArray(s.L1_Working.session_events)) s.L1_Working.session_events = [];
  if (!Array.isArray(s.L2_Episodic.weekly_archives)) s.L2_Episodic.weekly_archives = [];
  if (!Array.isArray(s.L2_Episodic.raw_data_lake)) s.L2_Episodic.raw_data_lake = [];
  if (!s.L3_Semantic.medical_knowledge_graph || typeof s.L3_Semantic.medical_knowledge_graph !== 'object') s.L3_Semantic.medical_knowledge_graph = d.L3_Semantic.medical_knowledge_graph;
  if (!s.L3_Semantic.evolutionary_weights || typeof s.L3_Semantic.evolutionary_weights !== 'object') s.L3_Semantic.evolutionary_weights = d.L3_Semantic.evolutionary_weights;
  if (!Array.isArray(s.L3_Semantic.calibration_deltas)) s.L3_Semantic.calibration_deltas = [];
  if (!Array.isArray(s.L3_Semantic.semantic_memories)) s.L3_Semantic.semantic_memories = [];
  if (!s.L3_Semantic.outcome_ledger || !Array.isArray(s.L3_Semantic.outcome_ledger.records)) s.L3_Semantic.outcome_ledger = { schemaVersion: 1, records: [] };
  if (!s.L4_Basal.user_preferences_vector || typeof s.L4_Basal.user_preferences_vector !== 'object') s.L4_Basal.user_preferences_vector = d.L4_Basal.user_preferences_vector;
  if (typeof s.L0_Ingestion_Cursors.last_sync_ms !== 'number') s.L0_Ingestion_Cursors.last_sync_ms = d.L0_Ingestion_Cursors.last_sync_ms;
  s._bioos_memory_schema = MEM_SCHEMA_VERSION; return s;
}

function _memCompactLakeItem(item) {
  if (!item || typeof item !== 'object') return item;
  var str = JSON.stringify(item);
  if (str.length <= 800) return item;
  return {
    timestamp: item.timestamp || new Date().toISOString(),
    data_type: item.data_type || 'dense_telemetry',
    _compacted: true,
    _originalBytes: str.length,
    summary: typeof item.payload === 'string' ? item.payload.substring(0, 150) + '...' : (item.payload && typeof item.payload === 'object' ? { keys: Object.keys(item.payload).slice(0, 5) } : 'compacted')
  };
}

function _memApplyHardLimits(s) {
  s.L1_Working.session_events = (s.L1_Working.session_events || []).slice(-MEM_LIMITS.L1_EVENTS).map(function(ev) { return _memSanitizeItem(ev, 500); });
  s.L2_Episodic.weekly_archives = (s.L2_Episodic.weekly_archives || []).slice(-MEM_LIMITS.L2_ARCHIVES);
  s.L2_Episodic.raw_data_lake = (s.L2_Episodic.raw_data_lake || []).slice(-MEM_LIMITS.L2_DATA_LAKE).map(_memCompactLakeItem);
  s.L3_Semantic.semantic_memories = s.L3_Semantic.semantic_memories.slice(-MEM_LIMITS.SEMANTIC_MEMORIES).map(function(atom) { return _memSanitizeItem(atom, 1600); });
  s.L1_Working.context_anxiety_flag = s.L1_Working.session_events.length >= Math.ceil(MEM_LIMITS.L1_EVENTS * BIOOS_CONFIG.MEMORY_LIMITS.COMPACTION_THRESHOLD_PCT);
  return s;
}

function _validateNVRAMState(n) {
  var state = _memApplyHardLimits(_memMigrateNVRAM(n));
  var json = JSON.stringify(state);
  if (_memUtf8ByteLength_(json) > MEM_LIMITS.MAX_SERIALIZED_BYTES) throw new Error('[MEMORY_CAPACITY] NVRAM excede el limite seguro de ' + MEM_LIMITS.MAX_SERIALIZED_BYTES + ' bytes.');
  return { state: state, json: json };
}

function _memCreateEnvelope(state, generation) { var x = _validateNVRAMState(state); return { format: 'BioOS-NVRAM-Recovery', schemaVersion: MEM_SCHEMA_VERSION, generation: generation, committedAt: new Date().toISOString(), checksum: _memChecksum(x.json), state: x.state }; }
function _memValidateEnvelope(e) { if (!e || e.format !== 'BioOS-NVRAM-Recovery' || typeof e.generation !== 'number' || !e.state) throw new Error('[VFS_RECOVERY_INVALID] Envelope inválido.'); if (_memChecksum(JSON.stringify(e.state)) !== e.checksum) throw new Error('[VFS_RECOVERY_INVALID] Checksum no coincide.'); var x = _validateNVRAMState(e.state); return { state: x.state, json: x.json, generation: e.generation }; }
function _memFindFile(folder, title) { if (!folder) return null; var fs = folder.searchFiles("title = '" + title + "' and trashed = false"); return fs.hasNext() ? fs.next() : null; }
function _memWriteSlot(folder, name, envelope) { if (!folder) return envelope; var f = _memFindFile(folder, name) || folder.createFile(name, '', MimeType.PLAIN_TEXT); f.setContent(JSON.stringify(envelope)); return _memValidateEnvelope(JSON.parse(f.getBlob().getDataAsString())); }
function _memReadSlot(folder, name) { if (!folder) return null; var f = _memFindFile(folder, name); if (!f) return null; try { return _memValidateEnvelope(JSON.parse(f.getBlob().getDataAsString())); } catch (e) { return null; } }

function _memReadPrimary(vfs) {
  var raw = vfs.nvramFile.getBlob().getDataAsString(), parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn('[VFS_WARN] JSON de NVRAM dañado o vacío; restaurando con baseline limpio.');
    var fallbackState = _memDefaultState();
    vfs.nvramFile.setContent(JSON.stringify(fallbackState));
    parsed = fallbackState;
  }
  return _validateNVRAMState(parsed);
}
function _memActiveRecovery(p, folder) { var active = p.getProperty('VFS_NVRAM_ACTIVE_SLOT'); return active === 'A' || active === 'B' ? _memReadSlot(folder, MEM_SLOT_NAMES[active]) : null; }

/** Read-only recovery diagnosis. It intentionally never repairs state. */
function inspectNVRAMRecovery() { return executeWithResilience('Mem_Inspect_Recovery', function () { return executeWithMutex('SCRIPT', function () { var v = _getVfsNodes(), p = PropertiesService.getScriptProperties(), primary; try { primary = _memReadPrimary(v); } catch (e) { primary = { error: e.message }; } var a = _memReadSlot(v.folder, MEM_SLOT_NAMES.A), b = _memReadSlot(v.folder, MEM_SLOT_NAMES.B), activeName = p.getProperty('VFS_NVRAM_ACTIVE_SLOT'), active = activeName === 'A' ? a : activeName === 'B' ? b : null, matching = !!(primary.json && active && _memChecksum(primary.json) === _memChecksum(active.json)); return { primaryValid: !primary.error, activeSlot: activeName || null, activeGeneration: active ? active.generation : null, primaryMatchesActive: matching, slots: { A: a ? { valid: true, generation: a.generation } : { valid: false }, B: b ? { valid: true, generation: b.generation } : { valid: false } }, repairRequired: !!(primary.error || (activeName && !matching)) }; }); }); }
/** Explicit operator action; no normal read path calls this. */
function repairNVRAMFromRecoverySlot(slot) { if (slot !== 'A' && slot !== 'B') throw new Error('[VFS_RECOVERY_ABORT] Slot debe ser A o B.'); return executeWithResilience('Mem_Explicit_Recovery', function () { return executeWithMutex('SCRIPT', function () { var v = _getVfsNodes(), p = PropertiesService.getScriptProperties(), recovery = _memReadSlot(v.folder, MEM_SLOT_NAMES[slot]); if (!recovery) throw new Error('[VFS_RECOVERY_ABORT] Slot no verificable.'); v.nvramFile.setContent(recovery.json); if (_memChecksum(_memReadPrimary(v).json) !== _memChecksum(recovery.json)) throw new Error('[VFS_RECOVERY_ABORT] Verificación posterior falló.'); p.setProperty('VFS_NVRAM_ACTIVE_SLOT', slot); _VFS_IN_MEMORY_CACHE = null; return { repaired: true, slot: slot, generation: recovery.generation }; }); }); }

/**
 * Lectura ultra-rápida y no bloqueante de la memoria del sistema (<2ms con caché RAM).
 */
function getSystemMemory() {
  if (_VFS_IN_MEMORY_CACHE) {
    return _VFS_IN_MEMORY_CACHE;
  }
  try {
    var v = _getVfsNodes();
    var nvram = _memReadPrimary(v);
    var romData = {};
    try {
      romData = JSON.parse(v.romFile.getBlob().getDataAsString());
    } catch (romErr) {
      romData = { _version: '5.1.0-fallback', agent_prompts: {} };
    }
    var memResult = { ROM: romData, NVRAM: nvram.state };
    _VFS_IN_MEMORY_CACHE = memResult;
    return memResult;
  } catch (fatalMemErr) {
    console.warn('[MEM_CORE_FALLBACK] getSystemMemory usó memoria basal:', fatalMemErr.message);
    return {
      ROM: {
        _version: '5.1.0-basal-fallback',
        agent_prompts: {
          orquestador: 'Eres el Orquestador BioOS. Genera un resumen ejecutivo claro y conciso para Telegram.',
          fisiologo: 'Eres el fisiólogo de BioOS.',
          somnologo: 'Eres el somnólogo de BioOS.',
          ejecutivo: 'Eres el agente ejecutivo de BioOS.',
          endocrinologo: 'Eres el endocrinólogo de BioOS.',
          psicologo_cog: 'Eres el psicólogo cognitivo de BioOS.'
        }
      },
      NVRAM: _memDefaultState()
    };
  }
}

function mutateNVRAM(mutator, operationName) {
  if (typeof mutator !== 'function') throw new Error('[ACID_ABORT] mutateNVRAM requiere un mutator.');
  return executeWithResilience(operationName || 'Mem_Mutate_NVRAM', function () {
    return executeWithMutex('SCRIPT', function () {
      var v = _getVfsNodes(), p = PropertiesService.getScriptProperties(), current = _memReadPrimary(v);
      var draft = _memClone(current.state), result = mutator(draft);
      if (result !== undefined) draft = result;
      var activeName = p.getProperty('VFS_NVRAM_ACTIVE_SLOT');
      var active = _memActiveRecovery(p, v.folder);
      var gen = active ? active.generation + 1 : 1;
      var envelope = _memCreateEnvelope(draft, gen);
      var next = activeName === 'A' ? 'B' : 'A';
      // Escribir slot de recuperación solo cada 3 mutaciones o para mutaciones de L2/L3 para máxima velocidad
      var shouldWriteSlot = (gen % 3 === 0) || (operationName && (operationName.includes('DataLake') || operationName.includes('Write_NVRAM') || operationName.includes('Semantic') || operationName.includes('Outcome')));
      if (v.folder && shouldWriteSlot) {
        try {
          _memWriteSlot(v.folder, MEM_SLOT_NAMES[next], envelope);
          p.setProperty('VFS_NVRAM_ACTIVE_SLOT', next);
        } catch (slotErr) {
          console.warn('[VFS_SLOT_WARN] Falló escritura en slot secundario:', slotErr.message);
        }
      }
      try {
        v.nvramFile.setContent(JSON.stringify(envelope.state));
      } catch (writeErr) {
        console.warn('[VFS_PRIMARY_WRITE_WARN] Escritura directa falló, actualizando en RAM:', writeErr.message);
      }
      _VFS_IN_MEMORY_CACHE = { ROM: (_VFS_IN_MEMORY_CACHE && _VFS_IN_MEMORY_CACHE.ROM) || {}, NVRAM: envelope.state };
      return envelope.state;
    });
  }, 2);
}

function commitNVRAM(newState) { var replacement = _memClone(newState); mutateNVRAM(function () { return replacement; }, 'Mem_Write_NVRAM'); return true; }
function ingestWorkingMemory(origin, tokens) { return mutateNVRAM(function (s) { s.L1_Working.session_events.push({ timestamp: new Date().toISOString(), origin: origin, data: tokens }); }, 'Mem_Ingest_L1').L1_Working.context_anxiety_flag; }

/** Spanish-first deterministic feature vector: private, bounded, no external embedding API. */
function Memory_vectorizeSemanticText(text) {
  var normalized = Memory_normalizeSemanticText_(text), vector = Array(MEMORY_VECTOR_DIMENSIONS).fill(0);
  if (!normalized) return { version: MEMORY_VECTOR_VERSION, dimensions: MEMORY_VECTOR_DIMENSIONS, vector: vector };
  var tokens = normalized.split(' ').filter(function(token) { return token.length > 1 && !Memory_SEMANTIC_STOPWORDS_[token]; });
  var synonyms = { correr: 'running', carrera: 'running', rodaje: 'running', trotar: 'running', sueño: 'sueno', dormir: 'sueno', descanso: 'sueno', pulso: 'frecuencia_cardiaca', rhr: 'frecuencia_cardiaca', fc: 'frecuencia_cardiaca', reloj: 'wearable', xiaomi: 'wearable', mi: 'wearable', fatiga: 'cansancio', cansancio: 'cansancio', dolor: 'molestia', molestia: 'molestia', lesion: 'molestia', entrenamiento: 'ejercicio', entrenar: 'ejercicio', workout: 'ejercicio', memoria: 'recuerdo', recordar: 'recuerdo' };
  tokens.forEach(function(token) {
    var features = [token, synonyms[token] || ''];
    features.forEach(function(feature, slot) {
      if (!feature) return;
      var hash = Memory_hashFeature_(feature), index = hash.index % MEMORY_VECTOR_DIMENSIONS;
      vector[index] += (hash.negative ? -1 : 1) * (slot ? 0.7 : 1);
    });
  });
  var norm = Math.sqrt(vector.reduce(function(sum, value) { return sum + value * value; }, 0));
  if (norm) vector = vector.map(function(value) { return Number((value / norm).toFixed(6)); });
  return { version: MEMORY_VECTOR_VERSION, dimensions: MEMORY_VECTOR_DIMENSIONS, vector: vector };
}

function Memory_storeSemantic(input) {
  input = input || {};
  var text = String(input.text || '').trim().slice(0, 800);
  if (text.length < 3) return { ok: false, reason: 'EMPTY_MEMORY' };
  var atom = Memory_createSemanticAtom_(input, text);
  mutateNVRAM(function(state) { state.L3_Semantic.semantic_memories = Memory_appendSemanticAtoms_(state.L3_Semantic.semantic_memories, [atom]); }, 'Mem_Write_Semantic');
  return { ok: true, id: atom.id, type: atom.type, expiresAt: atom.expiresAt };
}

function Memory_createSemanticAtom_(input, text) {
  var now = Date.now(), type = String(input.type || 'note').slice(0, 32), source = String(input.source || 'user_report').slice(0, 48);
  var ttl = Math.max(1, Math.min(365, Number(input.ttlDays) || (type === 'plan' ? 14 : type === 'symptom' ? 7 : 180)));
  var confidence = input.confidence === undefined ? (input.status === 'confirmed' ? 1 : 0.65) : Number(input.confidence);
  confidence = isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
  return {
    id: String(input.id || ('mem-' + now + '-' + Memory_hashFeature_(text).index.toString(36))),
    type: type, text: text, source: source, status: String(input.status || 'reported'), confidence: confidence,
    recordedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl * 86400000).toISOString(),
    evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds.map(String).slice(0, 8) : [],
    vector: Memory_vectorizeSemanticText(text)
  };
}

function Memory_appendSemanticAtoms_(memories, additions) {
  var now = Date.now();
  memories = memories.filter(function(existing) { return existing && Date.parse(existing.expiresAt) > now; });
  (additions || []).forEach(function(atom) {
    memories = memories.filter(function(existing) { return existing && existing.id !== atom.id && String(existing.text).toLowerCase() !== String(atom.text).toLowerCase(); });
    memories.push(atom);
  });
  memories.sort(function(a, b) { return Date.parse(a.recordedAt) - Date.parse(b.recordedAt); });
  return memories.slice(-MEM_LIMITS.SEMANTIC_MEMORIES);
}

function Memory_searchSemantic(query, options) {
  options = options || {};
  var q = Memory_vectorizeSemanticText(query), now = Date.now(), topK = Math.max(1, Math.min(8, Number(options.topK) || 5));
  if (!String(query || '').trim()) return [];
  var atoms = (((getSystemMemory() || {}).NVRAM || {}).L3_Semantic || {}).semantic_memories || [];
  return atoms.filter(function(atom) { return atom && atom.vector && atom.vector.version === q.version && Date.parse(atom.expiresAt) > now && atom.status !== 'superseded'; })
    .map(function(atom) { return { atom: atom, score: Memory_cosine_(q.vector, atom.vector.vector) }; })
    .filter(function(row) { return row.score >= (Number(options.minScore) || 0.12); })
    .sort(function(a, b) { return b.score - a.score || Date.parse(b.atom.recordedAt) - Date.parse(a.atom.recordedAt); })
    .slice(0, topK).map(function(row) { return { id: row.atom.id, type: row.atom.type, text: row.atom.text, source: row.atom.source, status: row.atom.status, confidence: row.atom.confidence, recordedAt: row.atom.recordedAt, expiresAt: row.atom.expiresAt, evidenceIds: (row.atom.evidenceIds || []).slice(0, 8), similarity: Number(row.score.toFixed(3)) }; });
}

/** Exact daily sensor observations stay structured in L2; they are not embedded as prose. */
function Memory_storeBiometricObservation(telemetry) {
  if (!telemetry || telemetry.is_live_telemetry !== true || !telemetry.data || !telemetry.window || !telemetry.window.startMs) return { ok: false, reason: 'NO_LIVE_OBSERVATION' };
  var observationId = 'bio-' + String(telemetry.window.startMs), observation = {
    observationId: observationId, timestamp: telemetry.fetchedAt || new Date().toISOString(),
    source: String(telemetry.source || 'unknown'), timeZone: String(telemetry.timeZone || 'unknown'),
    window: telemetry.window, sleepWindow: telemetry.sleepWindow || null,
    metrics: { steps: telemetry.data.steps, distanceKm: telemetry.data.distanceKm, caloriesKcal: telemetry.data.caloriesKcal, rhrBpm: telemetry.data.rhrBpm, sleepMinutes: telemetry.data.sleepMinutes }
  };
  mutateNVRAM(function(state) {
    var lake = state.L2_Episodic.raw_data_lake;
    state.L2_Episodic.raw_data_lake = lake.filter(function(item) { return !(item && item.data_type === 'biometric_daily' && item.payload && item.payload.observationId === observationId); });
    state.L2_Episodic.raw_data_lake.push({ timestamp: observation.timestamp, data_type: 'biometric_daily', payload: observation });
  }, 'Mem_Ingest_Biometric_Daily');
  return { ok: true, observationId: observationId };
}

function Memory_listBiometricObservations(options) {
  var limit = Math.max(1, Math.min(90, Number((options || {}).limit) || 14));
  var lake = ((((getSystemMemory() || {}).NVRAM || {}).L2_Episodic || {}).raw_data_lake || []);
  return lake.filter(function(item) { return item && item.data_type === 'biometric_daily' && item.payload && item.payload.observationId; })
    .slice(-limit).map(function(item) { return item.payload; });
}

/** Obsidian-like view assembled from semantic atoms and their evidence IDs. */
function Memory_buildEvidenceGraph_(atoms, observations) {
  atoms = Array.isArray(atoms) ? atoms : []; observations = Array.isArray(observations) ? observations : [];
  var observationIds = {};
  observations.forEach(function(item) { observationIds[item.observationId] = true; });
  var edges = [];
  atoms.forEach(function(atom) { (atom.evidenceIds || []).forEach(function(evidenceId) { if (observationIds[evidenceId]) edges.push({ from: atom.id, to: evidenceId, relation: 'reported_with_observation' }); }); });
  return {
    nodes: atoms.map(function(atom) { return { id: atom.id, kind: atom.type, text: atom.text, source: atom.source, status: atom.status, evidenceIds: atom.evidenceIds || [] }; }).concat(observations.map(function(item) { return { id: item.observationId, kind: 'biometric_daily', source: item.source, timestamp: item.timestamp, window: item.window, metrics: item.metrics }; })),
    edges: edges.slice(0, 60)
  };
}

function Memory_captureUserFeedback(userNlp, requestContext) {
  if (!userNlp || typeof userNlp !== 'object') return 0;
  var groups = [
    ['symptom', userNlp.sintomatologia_fisica, 7],
    ['load', userNlp.carga_alostatica_percibida, 7],
    ['nutrition', userNlp.adherencia_nutricional, 7],
    ['plan', userNlp.intenciones_futuras, 14]
  ], saved = 0, evidenceId = String((requestContext || {}).eventId || (requestContext || {}).requestId || ''), additions = [];
  var linkedEvidence = evidenceId ? [evidenceId] : [];
  if ((requestContext || {}).observationId) linkedEvidence.push(String(requestContext.observationId));
  groups.forEach(function(group) { (Array.isArray(group[1]) ? group[1] : []).slice(0, 8).forEach(function(text, index) {
    if (typeof text !== 'string' || text.trim().length < 3) return;
    additions.push(Memory_createSemanticAtom_({ id: 'nlp-' + Memory_hashFeature_(evidenceId + ':' + group[0] + ':' + text).index.toString(36), type: group[0], text: text, source: 'telegram_user_nlp', status: 'reported', ttlDays: group[2], evidenceIds: linkedEvidence }, text));
  }); });
  if (additions.length) { mutateNVRAM(function(state) { state.L3_Semantic.semantic_memories = Memory_appendSemanticAtoms_(state.L3_Semantic.semantic_memories, additions); }, 'Mem_Write_Semantic'); saved = additions.length; }
  return saved;
}

function Memory_listSemantic(options) {
  options = options || {}; var limit = Math.max(1, Math.min(20, Number(options.limit) || 10)), now = Date.now();
  var atoms = (((getSystemMemory() || {}).NVRAM || {}).L3_Semantic || {}).semantic_memories || [];
  return atoms.filter(function(atom) { return atom && Date.parse(atom.expiresAt) > now; }).slice(-limit).reverse().map(function(atom) { return { id: atom.id, type: atom.type, text: atom.text, source: atom.source, status: atom.status, confidence: atom.confidence, recordedAt: atom.recordedAt, expiresAt: atom.expiresAt }; });
}

function Memory_forgetSemantic(id) {
  var target = String(id || '').trim(), removed = 0;
  if (!target) return { ok: false, reason: 'ID_REQUIRED' };
  mutateNVRAM(function(state) { var before = state.L3_Semantic.semantic_memories.length; state.L3_Semantic.semantic_memories = state.L3_Semantic.semantic_memories.filter(function(atom) { return atom.id !== target; }); removed = before - state.L3_Semantic.semantic_memories.length; }, 'Mem_Write_Semantic');
  return { ok: removed > 0, removed: removed };
}

function Memory_recordUserOutcome(text, status, requestId) {
  var description = String(text || '').trim().slice(0, MEMORY_OUTCOME_LEDGER_MAX_TEXT_LENGTH);
  if (description.length < 3) return { ok: false, error: { code: 'OUTCOME_TEXT_REQUIRED' } };
  var id = 'outcome-' + Date.now() + '-' + Memory_hashFeature_(description).index.toString(36);
  var input = { outcomeId: id, decisionId: String(requestId || id), actionId: 'user-confirmed-session', status: String(status || 'COMPLETED').toUpperCase(), occurredAt: new Date().toISOString(), provenance: { source: 'telegram_explicit_user_confirmation', requestId: String(requestId || id), agentIds: ['user'], evidenceIds: [] }, assessment: { observedOutcome: description, utility: null, safetySignals: [] } };
  var prepared = Memory_prepareOutcomeRecord(input, {}, Date.now());
  if (!prepared.ok) return prepared;
  var appended = null;
  mutateNVRAM(function(state) {
    appended = Memory_appendOutcomeLedger(state.L3_Semantic.outcome_ledger, input, {}, Date.now());
    if (!appended.ok) throw new Error('[OUTCOME_LEDGER] ' + appended.error.code);
    state.L3_Semantic.outcome_ledger = appended.value;
  }, 'Mem_Write_Outcome_Ledger');
  return { ok: true, outcomeId: id, status: prepared.value.status, expiresAt: prepared.value.expiresAt };
}

var Memory_SEMANTIC_STOPWORDS_ = { de:1, la:1, el:1, los:1, las:1, un:1, una:1, y:1, o:1, en:1, con:1, para:1, por:1, que:1, es:1, mi:0, me:1, se:1, del:1, al:1, hoy:1, ayer:1, the:1, and:1, to:1, of:1, is:1 };
function Memory_normalizeSemanticText_(text) { return String(text || '').toLowerCase().normalize ? String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_ ]/g, ' ').replace(/\s+/g, ' ').trim() : String(text || '').toLowerCase().replace(/[^a-z0-9_ ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function Memory_hashFeature_(text) { var h = 2166136261, s = String(text); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h >>>= 0; return { index: h, negative: (h & 1) === 1 }; }
function Memory_cosine_(a, b) { if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0; var dot = 0; for (var i = 0; i < a.length; i++) dot += Number(a[i] || 0) * Number(b[i] || 0); return dot; }
function ingestToDataLake(dataType, rawPayload) { mutateNVRAM(function (s) { s.L2_Episodic.raw_data_lake.push({ timestamp: new Date().toISOString(), data_type: dataType, payload: rawPayload }); }, 'Mem_Ingest_DataLake'); return true; }
function getIngestionCursor() { return getSystemMemory().NVRAM.L0_Ingestion_Cursors.last_sync_ms; }
function updateIngestionCursor(ms) { mutateNVRAM(function (s) { s.L0_Ingestion_Cursors.last_sync_ms = ms; }, 'Mem_Write_Cursor'); return true; }
function initializeMemoryCore() { return executeWithResilience('Mem_Format_Partitions', function () { return executeWithMutex('SCRIPT', function () { var p = PropertiesService.getScriptProperties(); p.deleteProperty('VFS_FOLDER_ID'); p.deleteProperty('VFS_ROM_ID'); p.deleteProperty('VFS_NVRAM_ID'); _VFS_IN_MEMORY_CACHE = null; _VFS_NODES_CACHE = null; var fs = DriveApp.getFoldersByName('BioOS_Core'), folder = fs.hasNext() ? fs.next() : DriveApp.createFolder('BioOS_Core'); if (!_memFindFile(folder, 'BioOS_ROM.json')) folder.createFile('BioOS_ROM.json', JSON.stringify({ _version: '5.0.0-Autonomous-Cognitive-Kernel', _safety_invariants: ['No prescripción clínica severa.'], agent_prompts: {}, _cache_control: 'STATIC_BYTE_LOCKED' }), MimeType.PLAIN_TEXT); if (!_memFindFile(folder, 'BioOS_NVRAM.json')) folder.createFile('BioOS_NVRAM.json', JSON.stringify(_memDefaultState()), MimeType.PLAIN_TEXT); return true; }); }); }

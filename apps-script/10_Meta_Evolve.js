/** Controlled ROM governance: models propose; only an explicit human call applies. */
var META_REVIEW_FOLDER_NAME = 'BioOS_ROM_Review_Audit';
var META_PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
var META_MAX_PROMPT_CHARS = 8000;

function _metaSha256(text) { var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8); return b.map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join(''); }
function _metaClone(v) { return JSON.parse(JSON.stringify(v)); }
function _metaReviewFolder(vfs) { var it = vfs.folder.getFoldersByName(META_REVIEW_FOLDER_NAME); return it.hasNext() ? it.next() : vfs.folder.createFolder(META_REVIEW_FOLDER_NAME); }
function _metaWriteJson(folder, name, value) { return folder.createFile(name, JSON.stringify(value, null, 2), MimeType.PLAIN_TEXT); }
function _metaReadJson(file) { return JSON.parse(file.getBlob().getDataAsString()); }
function _metaProposalFile(folder, id) { if (!/^evo_[a-zA-Z0-9_-]+$/.test(String(id || ''))) return null; var it = folder.searchFiles("title = 'proposal_" + id + ".json' and trashed = false"); return it.hasNext() ? it.next() : null; }
function _metaSafePrompt(value) { var t = String(value || '').trim(); if (!t || t.length > META_MAX_PROMPT_CHARS) throw new Error('[META_REJECTED] Prompt vacío o excede el límite.'); if (/https?:\/\/|\b(api[_ -]?key|secret|token|password)\b/i.test(t)) throw new Error('[META_REJECTED] La propuesta contiene material no permitido.'); return t; }
function _metaValidateProposal(p) { if (!p || p.kind !== 'BIOOS_ROM_PROMPT_PROPOSAL' || !/^evo_[a-zA-Z0-9_-]+$/.test(p.id || '')) throw new Error('[META_REJECTED] Propuesta inválida.'); if (!p.agentKey || !p.baseRomVersion || !p.basePromptHash || !p.proposedPromptHash) throw new Error('[META_REJECTED] Propuesta incompleta.'); if (new Date(p.expiresAt).getTime() < Date.now()) throw new Error('[META_REJECTED] Propuesta expirada.'); _metaSafePrompt(p.proposedPrompt); return p; }

function triggerMetaEvolution() { return executeWithResilience('Meta_Evolve_Proposal', function () {
  var mem = getSystemMemory(), rom = mem.ROM, nvram = mem.NVRAM, archives = ((nvram.L2_Episodic || {}).weekly_archives || []), injuries = ((((nvram.L3_Semantic || {}).medical_knowledge_graph) || {}).lesiones_activas || []);
  if (!archives.length && !injuries.length) return { created: false, reason: 'INSUFFICIENT_EVIDENCE' };
  var selection = invokeUniversalLLM('Select one agent only for a human-reviewed prompt proposal. Do not authorize actions. Aggregated evidence: ' + JSON.stringify({ L3: nvram.L3_Semantic, archiveCount: archives.length }), 'Return a proposal candidate only.', { type: 'OBJECT', properties: { agente_objetivo: { type: 'STRING', enum: ['fisiologo', 'somnologo', 'endocrinologo', 'psicologo_cog'] }, justificacion_ineficacia: { type: 'STRING' } }, required: ['agente_objetivo', 'justificacion_ineficacia'] }, 0.2);
  if (!selection || !rom.agent_prompts || !rom.agent_prompts[selection.agente_objetivo]) throw new Error('[META_FAULT] Agente objetivo inválido o no registrado en ROM.');
  var current = rom.agent_prompts[selection.agente_objetivo];
  var mutation = invokeUniversalLLM('Draft only a replacement system prompt for ' + selection.agente_objetivo + '. Never include secrets, code, URLs, trigger instructions, or permission changes. Current prompt: ' + current + '. Invariants: ' + JSON.stringify(rom._safety_invariants || []), 'Create a bounded proposal pending human approval.', { type: 'OBJECT', properties: { nuevo_system_prompt: { type: 'STRING' }, cambio_estructural: { type: 'STRING' } }, required: ['nuevo_system_prompt', 'cambio_estructural'] }, 0.4);
  return _storeEvolutionProposal(selection.agente_objetivo, current, mutation, selection.justificacion_ineficacia, rom._version);
}); }

/** Creates an audit artifact; this function never writes ROM. */
function _storeEvolutionProposal(agentKey, currentPrompt, mutation, rationale, romVersion) {
  var proposed = _metaSafePrompt(mutation && mutation.nuevo_system_prompt), current = _metaSafePrompt(currentPrompt);
  if (proposed === current) return { created: false, reason: 'NO_MEANINGFUL_CHANGE' };
  return executeWithMutex('SCRIPT', function () { var vfs = _getVfsNodes(), folder = _metaReviewFolder(vfs), now = new Date(), id = 'evo_' + now.getTime() + '_' + Utilities.getUuid().slice(0, 8); var p = { kind: 'BIOOS_ROM_PROMPT_PROPOSAL', id: id, status: 'PENDING_HUMAN_REVIEW', createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + META_PROPOSAL_TTL_MS).toISOString(), baseRomVersion: String(romVersion || 'UNKNOWN'), agentKey: String(agentKey), rationale: String(rationale || '').slice(0, 2000), structuralChange: String((mutation || {}).cambio_estructural || '').slice(0, 2000), currentPrompt: current, proposedPrompt: proposed, basePromptHash: _metaSha256(current), proposedPromptHash: _metaSha256(proposed) }; _metaWriteJson(folder, 'proposal_' + id + '.json', p); sendSystemTelemetry('SUCCESS', '[META-EVOLVE] Propuesta ' + id + ' almacenada; ROM permanece sin cambios.'); return { created: true, proposalId: id, status: p.status, expiresAt: p.expiresAt }; });
}

/** Read-only operator APIs. Set includePrompts=true only in the trusted editor. */
function listPendingROMProposals(includePrompts) { return executeWithMutex('SCRIPT', function () { var it = _metaReviewFolder(_getVfsNodes()).searchFiles("title contains 'proposal_' and trashed = false"), out = []; while (it.hasNext()) try { var p = _metaReadJson(it.next()); if (p.status === 'PENDING_HUMAN_REVIEW' && new Date(p.expiresAt).getTime() >= Date.now()) out.push(includePrompts ? p : { id: p.id, status: p.status, createdAt: p.createdAt, expiresAt: p.expiresAt, baseRomVersion: p.baseRomVersion, agentKey: p.agentKey, rationale: p.rationale, structuralChange: p.structuralChange, proposedPromptHash: p.proposedPromptHash }); } catch (e) { sendSystemTelemetry('WARNING', '[META-EVOLVE] Artefacto ilegible: ' + e.message); } return out.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); }); }); }
function getROMProposalForReview(id) { return executeWithMutex('SCRIPT', function () { var f = _metaProposalFile(_metaReviewFolder(_getVfsNodes()), id); if (!f) throw new Error('[META_NOT_FOUND] Propuesta no encontrada.'); return _metaValidateProposal(_metaReadJson(f)); }); }
function _metaRequireApprovalToken(token) { var expected = PropertiesService.getScriptProperties().getProperty('META_EVOLVE_APPROVAL_TOKEN'); if (!expected || expected.length < 24) throw new Error('[META_APPROVAL_BLOCKED] Configure META_EVOLVE_APPROVAL_TOKEN (mínimo 24 caracteres).'); if (typeof token !== 'string' || token !== expected) throw new Error('[META_APPROVAL_BLOCKED] Token de aprobación inválido.'); }

/** Explicit human operation. No trigger or model calls this function. */
function approveROMProposal(id, approvalToken) { _metaRequireApprovalToken(approvalToken); return executeWithResilience('Meta_Approve_ROM_Proposal', function () { return executeWithMutex('SCRIPT', function () {
  var vfs = _getVfsNodes(), folder = _metaReviewFolder(vfs), f = _metaProposalFile(folder, id); if (!f) throw new Error('[META_NOT_FOUND] Propuesta no encontrada.'); var p = _metaValidateProposal(_metaReadJson(f)), rom = JSON.parse(vfs.romFile.getBlob().getDataAsString());
  if (p.status !== 'PENDING_HUMAN_REVIEW') throw new Error('[META_REJECTED] La propuesta no está pendiente.'); if (String(rom._version) !== p.baseRomVersion || !rom.agent_prompts || _metaSha256(rom.agent_prompts[p.agentKey] || '') !== p.basePromptHash) throw new Error('[META_STALE] ROM cambió desde la propuesta; cree una nueva revisión.');
  var snapshotId = 'rom_before_' + p.id, before = _metaClone(rom); _metaWriteJson(folder, snapshotId + '.json', { kind: 'BIOOS_ROM_SNAPSHOT', snapshotId: snapshotId, createdAt: new Date().toISOString(), proposalId: p.id, rom: before, checksum: _metaSha256(JSON.stringify(before)) });
  rom.agent_prompts[p.agentKey] = p.proposedPrompt; rom._version = String(rom._version || 'UNKNOWN') + '+rom-' + new Date().getTime(); rom._rom_governance = { lastApprovedProposalId: p.id, lastApprovedAt: new Date().toISOString(), rollbackSnapshotId: snapshotId }; vfs.romFile.setContent(JSON.stringify(rom));
  var verified = JSON.parse(vfs.romFile.getBlob().getDataAsString()); if (_metaSha256(verified.agent_prompts[p.agentKey] || '') !== p.proposedPromptHash) throw new Error('[META_ABORT] ROM write verification failed; restore snapshot explicitly.');
  _metaWriteJson(folder, 'approval_' + p.id + '.json', { kind: 'BIOOS_ROM_APPROVAL_AUDIT', proposalId: p.id, approvedAt: new Date().toISOString(), approvedBy: Session.getEffectiveUser().getEmail() || 'UNKNOWN', approvalTokenHash: _metaSha256(approvalToken), snapshotId: snapshotId, resultingRomVersion: verified._version }); p.status = 'APPROVED_AND_APPLIED'; p.appliedAt = new Date().toISOString(); p.resultingRomVersion = verified._version; f.setContent(JSON.stringify(p, null, 2)); sendSystemTelemetry('SUCCESS', '[META-EVOLVE] Propuesta ' + p.id + ' aprobada explícitamente.'); return { approved: true, proposalId: p.id, snapshotId: snapshotId, romVersion: verified._version };
}); }); }

/** Explicit human rollback to a verified snapshot created during approval. */
function rollbackROMFromSnapshot(snapshotId, approvalToken) { _metaRequireApprovalToken(approvalToken); return executeWithResilience('Meta_Rollback_ROM', function () { return executeWithMutex('SCRIPT', function () { if (!/^rom_before_evo_[a-zA-Z0-9_-]+$/.test(String(snapshotId || ''))) throw new Error('[META_ROLLBACK_BLOCKED] Snapshot inválido.'); var vfs = _getVfsNodes(), folder = _metaReviewFolder(vfs), it = folder.searchFiles("title = '" + snapshotId + ".json' and trashed = false"); if (!it.hasNext()) throw new Error('[META_NOT_FOUND] Snapshot no encontrado.'); var s = _metaReadJson(it.next()); if (!s || s.kind !== 'BIOOS_ROM_SNAPSHOT' || !s.rom || _metaSha256(JSON.stringify(s.rom)) !== s.checksum) throw new Error('[META_ROLLBACK_BLOCKED] Snapshot no verificable.'); vfs.romFile.setContent(JSON.stringify(s.rom)); if (_metaSha256(vfs.romFile.getBlob().getDataAsString()) !== _metaSha256(JSON.stringify(s.rom))) throw new Error('[META_ROLLBACK_ABORT] Verificación de restauración falló.'); _metaWriteJson(folder, 'rollback_' + snapshotId + '_' + new Date().getTime() + '.json', { kind: 'BIOOS_ROM_ROLLBACK_AUDIT', snapshotId: snapshotId, rolledBackAt: new Date().toISOString(), rolledBackBy: Session.getEffectiveUser().getEmail() || 'UNKNOWN', approvalTokenHash: _metaSha256(approvalToken) }); sendSystemTelemetry('WARNING', '[META-EVOLVE] ROM restaurada explícitamente desde ' + snapshotId + '.'); return { rolledBack: true, snapshotId: snapshotId }; }); }); }

function _applyEvolutionToROM(agentKey, newPrompt, rationale) { var memory = getSystemMemory(), current = ((memory.ROM.agent_prompts || {})[agentKey]); if (!current) throw new Error('[META_FAULT] Agente no mapeado: ' + agentKey); return _storeEvolutionProposal(agentKey, current, { nuevo_system_prompt: newPrompt, cambio_estructural: rationale || 'Solicitud heredada' }, rationale, memory.ROM._version); }
function installMetaEvolveDaemon() { sendSystemTelemetry('WARNING', '[META-EVOLVE] Daemon bloqueado: las revisiones ROM requieren un operador.'); return { installed: false, reason: 'AUTOMATIC_ROM_EVOLUTION_DISABLED' }; }

/**
 * BUCLE SEMANAL: Auditoría Mesocíclica & Balance Alostático (Domingos 18:00).
 */
function executeWeeklyAudit() {
  return executeWithResilience("Auditoria_Semanal_Longitudinal", function() {
    const memory = getSystemMemory();
    const rom = memory.ROM || {};
    const nvram = memory.NVRAM || {};
    const archives = (nvram.L2_Episodic && nvram.L2_Episodic.weekly_archives) || [];
    const events = (nvram.L1_Working && nvram.L1_Working.session_events) || [];
    const basal = nvram.L4_Basal || { baseline_rhr: 43, target_steps: 8000 };
    const deltas = (nvram.L3_Semantic && nvram.L3_Semantic.calibration_deltas) || [];

    const schema = {
      type: "OBJECT",
      properties: {
        mensaje_telegram: { type: "STRING", description: "Reporte Táctico Dominical formateado en HTML para Telegram." },
        resumen_ejecutivo: { type: "STRING" },
        adaptacion_gemelo_digital: { type: "OBJECT", properties: { acwr: { type: "NUMBER" }, rhr_trend: { type: "STRING" }, volumen_km_semana: { type: "NUMBER" } }, required: ["acwr", "rhr_trend", "volumen_km_semana"] },
        ajuste_microciclo_siguiente: { type: "STRING" }
      },
      required: ["mensaje_telegram", "resumen_ejecutivo", "adaptacion_gemelo_digital", "ajuste_microciclo_siguiente"]
    };

    const systemPrompt = `Eres el Agente Auditor Longitudinal y Fisiólogo Jefe de BioOS v5.3.
Tu misión es generar el REPORTE TÁCTICO DOMINICAL (Cierre de Semana) para un Ingeniero de I+D y Corredor de Fondo.
VETO DE HIERRO: Cero cortesía vacía, cero preguntas retóricas. Lenguaje técnico sobrio y directrices de carga exactas.

ESTRUCTURA OBLIGATORIA DEL REPORTE (formato HTML para Telegram):
🧬 <b>1. Estado del Gemelo Digital:</b> Adaptación mitocondrial, balance de fatiga y forma (ACWR estimado), tendencia de RHR semanal vs basal (${basal.baseline_rhr || 43} bpm).
🏃 <b>2. Ajuste de Volumen Microciclo Siguiente:</b> Kilometraje sugerido para la semana entrante, distribución de zonas (Z2 vs Z4) y días de descanso neuromuscular.
📌 <b>3. Alertas de Compromisos Clave:</b> Hitos de robótica/CAD, entregables y agenda prioritaria para la semana entrante.`;

    const contextPayload = {
      semana_eventos: events.slice(-10),
      ultimos_deltas: deltas.slice(-7),
      parametros_basales: basal,
      total_archivos_acumulados: archives.length
    };

    const response = invokeUniversalLLM(systemPrompt, JSON.stringify(contextPayload), schema, 0.2);

    let delivered = false;
    if (response && response.mensaje_telegram && typeof _rawSystemNotify === "function") {
      delivered = _rawSystemNotify("📊 <b>BioOS | Reporte Táctico Dominical</b>\n\n" + response.mensaje_telegram);
    }

    try {
      mutateNVRAM(function(state) {
        if (!state.L2_Episodic.weekly_archives) state.L2_Episodic.weekly_archives = [];
        state.L2_Episodic.weekly_archives.push({
          timestamp: new Date().toISOString(),
          type: "WEEKLY_AUDIT_SNAPSHOT",
          data: response.adaptacion_gemelo_digital || {},
          summary: response.resumen_ejecutivo || "Auditoría semanal completada."
        });
        state.L2_Episodic.weekly_archives = state.L2_Episodic.weekly_archives.slice(-12);
      }, "Commit_Weekly_Audit");
    } catch (e) {
      console.warn("[WEEKLY_AUDIT] No se pudo persistir snapshot en L2:", e.message);
    }

    return {
      success: true,
      delivered: delivered,
      audit: response
    };
  });
}

/**
 * BUCLE MENSUAL: Meta-Evolución & Auto-Tuning de Agentes (Día 1 de cada mes).
 */
function executeMonthlyMetaEvolution() {
  return executeWithResilience("Meta_Evolucion_Mensual", function() {
    const memory = getSystemMemory();
    const rom = memory.ROM || {};
    const nvram = memory.NVRAM || {};
    const archives = (nvram.L2_Episodic && nvram.L2_Episodic.weekly_archives) || [];
    const deltas = (nvram.L3_Semantic && nvram.L3_Semantic.calibration_deltas) || [];
    const weights = (nvram.L3_Semantic && nvram.L3_Semantic.evolutionary_weights) || { running_intensity_tolerance: 1.0, recovery_speed_factor: 1.0, task_completion_bias: 1.0 };

    const schema = {
      type: "OBJECT",
      properties: {
        mensaje_telegram: { type: "STRING" },
        pesos_ajustados: { type: "OBJECT", properties: { running_intensity_tolerance: { type: "NUMBER" }, recovery_speed_factor: { type: "NUMBER" }, task_completion_bias: { type: "NUMBER" } }, required: ["running_intensity_tolerance", "recovery_speed_factor", "task_completion_bias"] },
        diagnostico_evolutivo: { type: "STRING" },
        propuesta_mutacion_prompt: { type: "STRING" }
      },
      required: ["mensaje_telegram", "pesos_ajustados", "diagnostico_evolutivo"]
    };

    const systemPrompt = `Eres el Motor de Meta-Evolución Cognitiva de BioOS v5.3.
Audita los últimos 30 días de dispersión, desvíos y feedback del usuario.
Calcula los nuevos "pesos_ajustados" para afinar la sensibilidad de los agentes y genera un mensaje ejecutivo breve para Telegram notificando el balance evolutivo mensual.`;

    const contextPayload = {
      archivos_semanales: archives.slice(-4),
      deltas_calibracion: deltas.slice(-15),
      pesos_actuales: weights
    };

    const response = invokeUniversalLLM(systemPrompt, JSON.stringify(contextPayload), schema, 0.2);

    if (response && response.pesos_ajustados) {
      try {
        mutateNVRAM(function(state) {
          if (!state.L3_Semantic) state.L3_Semantic = {};
          state.L3_Semantic.evolutionary_weights = response.pesos_ajustados;
          state.L3_Semantic.calibration_deltas = (state.L3_Semantic.calibration_deltas || []).slice(-5);
        }, "Commit_Meta_Evolution_Weights");
      } catch (e) {
        console.warn("[META_EVOLVE] Error persistiendo nuevos pesos:", e.message);
      }
    }

    let delivered = false;
    if (response && response.mensaje_telegram && typeof _rawSystemNotify === "function") {
      delivered = _rawSystemNotify("🧬 <b>BioOS | Ciclo Mensual de Meta-Evolución</b>\n\n" + response.mensaje_telegram);
    }

    return {
      success: true,
      delivered: delivered,
      evolution: response
    };
  });
}

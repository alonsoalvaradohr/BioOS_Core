// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/**
 * ==============================================================================
 * ARCHIVO: 11_Net_Daemons.gs
 * SISTEMA: BioOS v4.1 (Arquitectura SRE)
 * DESCRIPCIÓN: Trabajadores asíncronos y Triggers Cronobiológicos.
 * HITO 0.6 (Fase Final): Conexión al Repositorio de Datos Central (DB_Repository).
 * Delegación de drenaje y purga de cola L0 para erradicar duplicidad I/O.
 * ==============================================================================
 */

function workerProcessNLP() {
  // A one-shot worker owns only its trigger lifecycle. Queue state remains in L0
  // and is never drained/deleted by this function.
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "workerProcessNLP") {
      try { ScriptApp.deleteTrigger(triggers[i]); }
      catch (e) { if (typeof sendSystemTelemetry === 'function') sendSystemTelemetry("WARNING", `[TRIGGER_CLEANUP_FAULT] ${e.message}`); }
    }
  }

  var leaseMs = _workerLeaseMs_();
  var batchSize = _workerBatchSize_();
  var jobs;
  try {
    if (typeof repoClaimNLPJobs !== "function" || typeof repoCompleteNLPJobs !== "function") {
      throw new Error("[SRE_FAULT] DB_Repository claim/complete no disponible.");
    }
    jobs = repoClaimNLPJobs(batchSize, leaseMs);
  } catch (error) {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("ERROR", `[WORKER_CLAIM_FAULT] ${error.message}`);
    return;
  }
  if (!jobs.length) return { claimed: 0, completed: 0 };

  var context = _workerContext_(jobs);
  try {
    var payload = _workerBuildPayload_(jobs);
    _workerTelemetry_(context, 'PROCESS', '[WORKER] L0 lease adquirido; entregando lote al enrutador.', { jobs: jobs.length });
    // No executeWithResilience here: retrying a completed external action before
    // marking its job complete breaks exactly-once effects. A failed invocation
    // retains its lease and is retried by a later worker exactly as a job.
    if (typeof routeCognitiveTask !== 'function') throw new Error('[SRE_FAULT] routeCognitiveTask no disponible.');
    routeCognitiveTask('USER_FEEDBACK', payload);
    var completed = repoCompleteNLPJobs(jobs.map(function(job) { return job.jobId; }), 'completed');
    _workerTelemetry_(context, 'SUCCESS', '[WORKER] Lote confirmado como completado.', { jobs: completed });
    // A full claim may indicate backlog. Schedule a fresh one-shot worker; it
    // will safely stop when no pending/expired job exists.
    if (jobs.length >= batchSize) _workerSchedule_(1000);
    return { claimed: jobs.length, completed: completed };
  } catch (error) {
    var message = String(error && error.message || error).substring(0, 1000);
    var terminalJobs = jobs.filter(function(job) { return Number(job.attempts) >= _workerMaxAttempts_(); });
    var terminalIds = terminalJobs.map(function(job) { return job.jobId; });
    if (terminalIds.length) {
      repoCompleteNLPJobs(terminalIds, 'failed', message);
      // DEAD-LETTER PROTOCOL: Garantía de Egress (Zero Silent Drops)
      terminalJobs.forEach(function(termJob) {
        _dispatchDeadLetterPanic_(termJob, message);
      });
    }
    // Non-terminal jobs deliberately remain processing until their lease expires.
    // This preserves the input after a hard timeout/crash without a destructive drain.
    _workerTelemetry_(context, 'ERROR', '[WORKER_PROCESS_FAULT] Job retenido para reintento por lease: ' + message,
      { claimed: jobs.length, terminalFailed: terminalIds.length });
    _workerSchedule_(leaseMs + 1000);
    return { claimed: jobs.length, completed: 0, retryScheduled: true, error: message };
  }
}

/**
 * DEAD-LETTER PROTOCOL (Zero Silent Drops)
 * Emite una alerta estructurada de pánico por Telegram cuando un job de ingesta colapsa
 * definitivamente tras alcanzar el límite de reintentos, informando al usuario la causa exacta
 * y evitando la inanición o el silencio del canal.
 */
function _dispatchDeadLetterPanic_(job, errorMessage) {
  try {
    var meta = (job && job.metadata) || {};
    var chatId = meta.chatId || null;
    var kind = meta.kind || 'desconocido';
    var shortJobId = (job && job.jobId) ? String(job.jobId).substring(0, 8) : 'N/A';

    var panicMessage =
      '🚨 <b>[BIOOS_PANIC] Fallo en Procesamiento de Ingesta</b>\n\n' +
      'No fue posible procesar tu mensaje (tipo: <b>' + kind + '</b>) tras ' + (job.attempts || 1) + ' intentos automáticos.\n\n' +
      '• <b>ID Transacción:</b> <code>' + shortJobId + '</code>\n' +
      '• <b>Diagnóstico:</b> <code>' + String(errorMessage || 'Error no especificado').substring(0, 180) + '</code>\n\n' +
      '💡 <i>El estado transaccional fue aislado en la cola Dead-Letter (L0). Por favor reenvía el contenido o intenta con texto directo.</i>';

    if (typeof _rawSystemNotify === 'function') {
      _rawSystemNotify(panicMessage, chatId);
    }
  } catch (e) {
    if (typeof sendSystemTelemetry === 'function') {
      sendSystemTelemetry('FATAL', '[DEAD_LETTER_PANIC_FAULT] Falló emisión de Dead-Letter: ' + e.message);
    }
  }
}

function _workerBuildPayload_(jobs) {
  var items = jobs.map(function(job) {
    var metadata = job.metadata || {};
    if (metadata.kind === 'telegram_voice') {
      if (!metadata.fileId) throw new Error('[VOICE_METADATA] fileId ausente en job ' + job.jobId);
      var base64Audio = typeof _downloadTelegramVoice === 'function' ? _downloadTelegramVoice(metadata.fileId) : (typeof _downloadTelegramFile === 'function' ? _downloadTelegramFile(metadata.fileId) : null);
      if (!base64Audio) throw new Error('[VOICE_DOWNLOAD_FAILED] No se pudo descargar audio para job ' + job.jobId);
      return { kind: 'voice', mimeType: metadata.mimeType || 'audio/ogg', data: base64Audio,
        eventId: metadata.updateId || job.idempotencyKey };
    }
    if (metadata.kind === 'telegram_photo') {
      if (!metadata.fileId) throw new Error('[PHOTO_METADATA] fileId ausente en job ' + job.jobId);
      var base64Photo = typeof _downloadTelegramPhoto === 'function' ? _downloadTelegramPhoto(metadata.fileId) : (typeof _downloadTelegramFile === 'function' ? _downloadTelegramFile(metadata.fileId) : null);
      if (!base64Photo) throw new Error('[PHOTO_DOWNLOAD_FAILED] No se pudo descargar imagen para job ' + job.jobId);
      return { kind: 'photo', mimeType: metadata.mimeType || 'image/jpeg', data: base64Photo,
        caption: String(metadata.caption || ''), eventId: metadata.updateId || job.idempotencyKey };
    }
    return { kind: 'text', text: String(job.message || ''), eventId: metadata.updateId || job.idempotencyKey };
  });
  return JSON.stringify({ _type: 'bioos_ingress_batch', items: items });
}

function _workerLeaseMs_() { return _workerPropertyInt_('BIOOS_QUEUE_LEASE_MS', 120000, 10000, 300000); }
function _workerBatchSize_() { return _workerPropertyInt_('BIOOS_QUEUE_WORKER_BATCH_SIZE', 10, 1, 50); }
function _workerMaxAttempts_() { return _workerPropertyInt_('BIOOS_QUEUE_MAX_ATTEMPTS', 3, 1, 20); }
function _workerPropertyInt_(key, fallback, min, max) {
  var value = fallback;
  try { value = Number(PropertiesService.getScriptProperties().getProperty(key)) || fallback; } catch (_) {}
  return Math.max(min, Math.min(max, Math.floor(value)));
}
function _workerSchedule_(afterMs) {
  var existing = ScriptApp.getProjectTriggers().some(function(trigger) { return trigger.getHandlerFunction() === 'workerProcessNLP'; });
  if (!existing) ScriptApp.newTrigger('workerProcessNLP').timeBased().after(Math.max(1000, Number(afterMs) || 1000)).create();
}
function _workerContext_(jobs) {
  var first = jobs[0] || {};
  if (typeof Core_createRequestContext === 'function') return Core_createRequestContext({ eventId: first.jobId, idempotencyKey: first.idempotencyKey,
    operation: typeof CORE_OPERATION !== 'undefined' ? CORE_OPERATION.QUEUE_WORKER : 'queue_worker', source: 'queue' });
  return { eventId: first.jobId || '', idempotencyKey: first.idempotencyKey || '', operation: 'queue_worker' };
}
function _workerTelemetry_(context, severity, message, fields) {
  if (typeof sendContextualTelemetry === 'function') return sendContextualTelemetry(context, severity, message, fields);
  if (typeof sendSystemTelemetry === 'function') return sendSystemTelemetry(severity, message, fields);
}

/**
 * ==============================================================================
 * RELOJ CRONOBIOLÓGICO (Triggers de Extracción Biométrica)
 * ==============================================================================
 */
function triggerMorningBriefing() {
  return executeWithResilience("Cron_MorningBriefing", () => {
    console.log("[CRON_START] 04:30 - Iniciando Triage Matutino programado...");
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", "[CRON] 04:30 - Disparando Triage Matutino...");
    const success = routeCognitiveTask("MORNING_BRIEFING", {});
    console.log(`[CRON_END] Triage Matutino finalizado. Resultado entrega: ${success}`);
    return success;
  });
}

function triggerEveningBriefing() {
  return executeWithResilience("Cron_EveningBriefing", () => {
    console.log("[CRON_START] 19:30 - Iniciando Triage Vespertino programado...");
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", "[CRON] 19:30 - Disparando Triage Vespertino...");
    const success = routeCognitiveTask("EVENING_BRIEFING", {});
    console.log(`[CRON_END] Triage Vespertino finalizado. Resultado entrega: ${success}`);
    return success;
  });
}

function triggerWeeklyAudit() {
  return executeWithResilience("Cron_WeeklyAudit", () => {
    console.log("[CRON_START] Domingo 18:00 - Iniciando Auditoría Táctica Semanal...");
    if (typeof executeWeeklyAudit === "function") return executeWeeklyAudit();
    throw new Error("[CRON_FAULT] executeWeeklyAudit no disponible.");
  });
}

function triggerMonthlyMetaEvolution() {
  return executeWithResilience("Cron_MonthlyMetaEvolution", () => {
    console.log("[CRON_START] Día 1 - Iniciando Ciclo Mensual de Meta-Evolución...");
    if (typeof executeMonthlyMetaEvolution === "function") return executeMonthlyMetaEvolution();
    throw new Error("[CRON_FAULT] executeMonthlyMetaEvolution no disponible.");
  });
}

/**
 * ==============================================================================
 * UTILIDADES DE MANTENIMIENTO Y AUTO-RECUPERACIÓN IDEMPOTENTE DE DISPARADORES
 * ==============================================================================
 */
function installCronobiologicalTriggers() {
  return reconcileCronobiologicalTriggers();
}

/**
 * Reconcilia de manera estrictamente idempotente los 4 disparadores del reloj cronobiológico.
 * Purgará cualquier trigger huérfano o repetido y garantizará exactamente 1 instancia de cada handler canónico.
 */
function reconcileCronobiologicalTriggers() {
  return executeWithResilience("Reconcile_Cron_Triggers", () => {
    const tz = (typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG.TIMING && BIOOS_CONFIG.TIMING.TIMEZONE)
      ? BIOOS_CONFIG.TIMING.TIMEZONE : "America/Costa_Rica";

    const canonicalTargets = {
      triggerMorningBriefing: { type: 'daily', hour: 4 },
      triggerEveningBriefing: { type: 'daily', hour: 19 },
      triggerWeeklyAudit: { type: 'weekly', hour: 18, day: ScriptApp.WeekDay.SUNDAY },
      triggerMonthlyMetaEvolution: { type: 'monthly', hour: 2, monthDay: 1 }
    };

    // 1. Auditar y purgar disparadores huérfanos o duplicados
    const currentTriggers = ScriptApp.getProjectTriggers();
    const seenHandlers = {};

    currentTriggers.forEach(trigger => {
      const handler = trigger.getHandlerFunction();
      if (!canonicalTargets[handler] || seenHandlers[handler]) {
        try {
          ScriptApp.deleteTrigger(trigger);
          console.log(`[TRIGGER_CLEAN] Eliminado disparador huérfano/duplicado: ${handler}`);
        } catch (e) {
          console.warn(`[TRIGGER_CLEAN_WARN] Error borrando trigger ${handler}: ${e.message}`);
        }
      } else {
        seenHandlers[handler] = true;
      }
    });

    // 2. Instalar los handlers canónicos faltantes
    const installed = [];
    Object.keys(canonicalTargets).forEach(handler => {
      if (!seenHandlers[handler]) {
        const config = canonicalTargets[handler];
        if (config.type === 'daily') {
          ScriptApp.newTrigger(handler).timeBased().inTimezone(tz).atHour(config.hour).everyDays(1).create();
        } else if (config.type === 'weekly') {
          ScriptApp.newTrigger(handler).timeBased().inTimezone(tz).onWeekDay(config.day).atHour(config.hour).create();
        } else if (config.type === 'monthly') {
          ScriptApp.newTrigger(handler).timeBased().inTimezone(tz).onMonthDay(config.monthDay).atHour(config.hour).create();
        }
        installed.push(handler);
        console.log(`[TRIGGER_RECONCILE] Disparador instalado: ${handler} (${tz})`);
      }
    });

    // 3. Obtener la lista final verificada de disparadores activos
    const verifiedTriggers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());

    return {
      reconciled: true,
      installed: installed,
      activeTriggers: verifiedTriggers,
      totalActiveCount: verifiedTriggers.length
    };
  });
}
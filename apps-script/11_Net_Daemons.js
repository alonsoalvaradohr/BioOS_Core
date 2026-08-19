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
    var terminalIds = jobs.filter(function(job) { return Number(job.attempts) >= _workerMaxAttempts_(); }).map(function(job) { return job.jobId; });
    if (terminalIds.length) repoCompleteNLPJobs(terminalIds, 'failed', message);
    // Non-terminal jobs deliberately remain processing until their lease expires.
    // This preserves the input after a hard timeout/crash without a destructive drain.
    _workerTelemetry_(context, 'ERROR', '[WORKER_PROCESS_FAULT] Job retenido para reintento por lease: ' + message,
      { claimed: jobs.length, terminalFailed: terminalIds.length });
    _workerSchedule_(leaseMs + 1000);
    return { claimed: jobs.length, completed: 0, retryScheduled: true, error: message };
  }
}

function _workerBuildPayload_(jobs) {
  return jobs.map(function(job) {
    var metadata = job.metadata || {};
    if (metadata.kind !== 'telegram_voice') return job.message;
    if (!metadata.fileId) throw new Error('[VOICE_METADATA] fileId ausente en job ' + job.jobId);
    // The worker is the only place permitted to fetch media.  Base64 is held only
    // for this execution and is never written back to L0.
    var base64Audio = _downloadTelegramVoice(metadata.fileId);
    return JSON.stringify({ _type: 'multimodal_voice', mimeType: metadata.mimeType || 'audio/ogg', data: base64Audio,
      source: 'telegram', eventId: metadata.updateId || job.idempotencyKey });
  }).join('\n[SIGUIENTE_MENSAJE]: ');
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
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", "[CRON] 04:30 - Disparando Triage Matutino...");
    routeCognitiveTask("MORNING_BRIEFING", {});
    return true;
  });
}

function triggerEveningBriefing() {
  return executeWithResilience("Cron_EveningBriefing", () => {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", "[CRON] 19:30 - Disparando Triage Vespertino...");
    routeCognitiveTask("EVENING_BRIEFING", {});
    return true;
  });
}

/**
 * ==============================================================================
 * UTILIDADES DE MANTENIMIENTO
 * ==============================================================================
 */
function installCronobiologicalTriggers() {
  return executeWithResilience("Install_Cron_Triggers", () => {
    const triggers = ScriptApp.getProjectTriggers();
    const funcsToClean = ["triggerNightIngest", "triggerMorningBriefing", "triggerEveningIngest", "triggerEveningBriefing", "workerProcessNLP"];

    for (let i = 0; i < triggers.length; i++) {
      if (funcsToClean.includes(triggers[i].getHandlerFunction())) {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }

    const tz = BIOOS_CONFIG.TIMING.TIMEZONE;
    // Disparos diarios exactos usando la topología v4.1
    ScriptApp.newTrigger("triggerMorningBriefing").timeBased().inTimezone(tz).atHour(4).nearMinute(30).everyDays(1).create();
    ScriptApp.newTrigger("triggerEveningBriefing").timeBased().inTimezone(tz).atHour(19).nearMinute(30).everyDays(1).create();

    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("SUCCESS", "[OPS] Reloj Cronobiológico v4.1 configurado sin solapamientos.");
    return true;
  });
}

function emergencyStopAndPurge() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("PROCESSED_UPDATES");

  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // PURGA DE EMERGENCIA DELEGADA AL REPOSITORIO
  // El repositorio es el único propietario del lock de la cola; bloquear aquí
  // provocaba auto-deadlock cuando repoEmergencyPurgeQueue adquiría ScriptLock.
  if (typeof repoEmergencyPurgeQueue === "function") repoEmergencyPurgeQueue();

  console.warn("[SRE] Paro de Emergencia Completado. Triggers destruidos y cola purgada.");
}

/** BioOS v5 bounded cognitive orchestration. */
const _ORCHESTRATOR_MAX_SPECIALISTS = 3;
const _ORCHESTRATOR_MIN_NEXT_CALL_MS = 30000;
const _ORCHESTRATOR_MIN_SYNTHESIS_MS = 20000;

function routeCognitiveTask(triggerEvent, rawPayload, requestContext) {
  const context = _orchestratorContext_(triggerEvent, rawPayload, requestContext);
  return executeWithResilience('Orchestrator_Routing_' + triggerEvent, function() {
    _orchestratorRequireBudget_(context, 0, 'ingesta');
    _orchestratorTelemetry_(context, 'PROCESS', '[ORCHESTRATOR] Inicio de triaje maestro.', { triggerEvent: triggerEvent });
    const memory = getSystemMemory();
    const rom = memory.ROM || {};
    const payload = _buildOrchestrationPayload_(triggerEvent, rawPayload, memory, context);
    const active = _determineActiveSpecialists(triggerEvent, rom.agent_prompts || {});
    const responses = _invokeSpecialistsCluster(active, payload, context);
    const approved = _auditSpecialistCluster_(responses, context);
    const taskCount = _injectAuditedTasks_(approved, context);
    const output = _synthesizeOrchestration_(rom, memory, payload, approved, taskCount, context);
    let compact = false;
    if (typeof ingestWorkingMemory === 'function') try {
      compact = ingestWorkingMemory(triggerEvent, { tokens: payload, hipotesis: approved, sintesis: output.resumen_ejecutivo || 'Sin síntesis.', requestId: context.requestId, eventId: context.eventId });
    } catch (error) { _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] No se pudo persistir L1.', { error: Core_normalizeError(error).code }); }
    if (typeof _rawSystemNotify === 'function' && output.mensaje_telegram) _rawSystemNotify('🧠 <b>BioOS Orchestrator</b>\n\n' + output.mensaje_telegram);
    if (compact && typeof forceContextCompaction === 'function' && Core_remainingBudgetMs(context) >= _ORCHESTRATOR_MIN_NEXT_CALL_MS) forceContextCompaction();
    _orchestratorTelemetry_(context, 'SUCCESS', '[ORCHESTRATOR] Ciclo completado.', { triggerEvent: triggerEvent, injectedTasksCount: taskCount });
    return true;
  });
}

function _orchestratorContext_(triggerEvent, rawPayload, supplied) {
  if (supplied && supplied.requestId && supplied.deadlineMs) return supplied;
  if (typeof Core_createRequestContext !== 'function') throw new Error('[CORE_CONTEXT_MISSING] Request context dependency unavailable.');
  return Core_createRequestContext({ operation: typeof CORE_OPERATION !== 'undefined' ? CORE_OPERATION.QUEUE_WORKER : 'queue_worker', source: 'orchestrator:' + String(triggerEvent || 'unknown'), eventId: rawPayload && rawPayload.eventId, idempotencyKey: rawPayload && rawPayload.idempotencyKey });
}

function _buildOrchestrationPayload_(triggerEvent, rawPayload, memory, context) {
  const payload = {};
  if (triggerEvent === 'MORNING_BRIEFING' || triggerEvent === 'EVENING_BRIEFING') {
    // Sensor_Engine is sole owner of Mobvoi/Fit selection and normalized DTOs.
    payload.biometric_snapshot = _safeETL('Sensor_Engine', typeof getBiometricSnapshot === 'function' ? getBiometricSnapshot : null, { source: 'unavailable', available: false, data: null });
    payload.workspace_agenda = _safeETL('Calendar_API', typeof fetchTodayCalendarEvents === 'function' ? fetchTodayCalendarEvents : null, []);
    payload.workspace_emails = _safeETL('Gmail_API', typeof fetchRecentUnreadContext === 'function' ? fetchRecentUnreadContext : null, []);
  } else if (triggerEvent === 'USER_FEEDBACK') {
    payload.user_nlp = typeof compileQualitativeFeedback === 'function' ? compileQualitativeFeedback(rawPayload) : rawPayload;
  } else throw new Error('[CORE_FAULT] Trigger no reconocido: ' + triggerEvent);
  payload.cmo_long_term_trends = (((memory || {}).NVRAM || {}).L3_Semantic || {}).medical_knowledge_graph || {};
  payload.request_context = { requestId: context.requestId, eventId: context.eventId, source: context.source };
  return payload;
}

function _safeETL(taskName, etlFunction, fallbackValue) {
  try { return typeof etlFunction === 'function' ? etlFunction() : fallbackValue; }
  catch (error) { if (typeof sendSystemTelemetry === 'function') sendSystemTelemetry('WARNING', '[ETL_FAULT] ' + taskName + ': ' + error.message); return fallbackValue; }
}

function _determineActiveSpecialists(triggerEvent, promptsROM) {
  if (typeof selectRegisteredSpecialists !== 'function') throw new Error('[AGENT_REGISTRY_MISSING] Registro de especialistas no disponible.');
  return selectRegisteredSpecialists(triggerEvent, promptsROM || {});
}

function _invokeSpecialistsCluster(active, payload, context) {
  const results = {}, all = Object.keys(active || {}), names = all.slice(0, _ORCHESTRATOR_MAX_SPECIALISTS);
  if (all.length > names.length) _orchestratorTelemetry_(context, 'WARNING', '[ORCHESTRATOR] Especialistas diferidos por presupuesto.', { deferred: all.length - names.length });
  names.forEach(function(name) {
    if (Core_remainingBudgetMs(context) < _ORCHESTRATOR_MIN_NEXT_CALL_MS) { _orchestratorTelemetry_(context, 'WARNING', '[ORCHESTRATOR] Especialista diferido por deadline.', { specialist: name }); return; }
    try { results[name] = evaluateSpecialistNode(name, active[name], payload); }
    catch (error) { _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] Especialista omitido.', { specialist: name, error: Core_normalizeError(error).code }); }
  });
  return results;
}

function _auditSpecialistCluster_(responses, context) {
  const validated = {};
  Object.keys(responses || {}).forEach(function(name) {
    // Fail closed: only a completed audit can retain executable tasks.
    if (typeof auditAndValidateHypothesis !== 'function' || Core_remainingBudgetMs(context) < _ORCHESTRATOR_MIN_NEXT_CALL_MS) {
      validated[name] = _orchestratorBlockActions_(responses[name], 'AUDIT_UNAVAILABLE_OR_DEADLINE'); return;
    }
    try { validated[name] = auditAndValidateHypothesis(name, responses[name]); }
    catch (error) { validated[name] = _orchestratorBlockActions_(responses[name], 'AUDIT_FAILURE'); _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] Auditoría falló; acciones anuladas.', { specialist: name, error: Core_normalizeError(error).code }); }
  });
  return validated;
}

function _injectAuditedTasks_(hypotheses, context) {
  let count = 0;
  if (typeof createProactiveTask !== 'function') return count;
  Object.keys(hypotheses || {}).forEach(function(specialist) {
    const tasks = hypotheses[specialist] && Array.isArray(hypotheses[specialist].tareas_ejecutivas) ? hypotheses[specialist].tareas_ejecutivas : [];
    tasks.slice(0, 3).forEach(function(task) {
      if (Core_remainingBudgetMs(context) < _ORCHESTRATOR_MIN_NEXT_CALL_MS || !task || !task.titulo) return;
      try { if (createProactiveTask('[' + specialist.toUpperCase() + '] ' + task.titulo, task.notas || '')) count++; }
      catch (error) { _orchestratorTelemetry_(context, 'ERROR', '[TASK_INJECTION_FAULT] Tarea omitida.', { specialist: specialist, error: Core_normalizeError(error).code }); }
    });
  });
  return count;
}

function _synthesizeOrchestration_(rom, memory, payload, hypotheses, taskCount, context) {
  if (Core_remainingBudgetMs(context) < _ORCHESTRATOR_MIN_SYNTHESIS_MS || typeof invokeUniversalLLM !== 'function') return _orchestratorDegradedOutput_(taskCount);
  const cooldown = _calculateCognitiveCooldown(((((memory || {}).NVRAM || {}).L1_Working || {}).session_events || []), 12);
  const schema = { type: 'OBJECT', properties: { mensaje_telegram: { type: 'STRING' }, resumen_ejecutivo: { type: 'STRING' } }, required: ['mensaje_telegram', 'resumen_ejecutivo'] };
  const prompt = String(((rom.agent_prompts || {}).orquestador) || 'Orquestador BioOS') + '\n[POLÍTICA] ' + (cooldown.active ? 'No hagas preguntas directas.' : 'Máximo una pregunta estratégica si faltan datos.') + '\nNo diagnósticos médicos ni datos crudos. Tareas aprobadas: ' + taskCount + '\nL1: ' + _orchestratorJson_(((((memory || {}).NVRAM || {}).L1_Working || {}).session_events || []).slice(-10), 8000, '[]') + '\nDatos: ' + _orchestratorJson_(payload, 10000, '{}') + '\nHipótesis: ' + _orchestratorJson_(hypotheses, 10000, '{}');
  try {
    const response = invokeUniversalLLM(prompt, 'Sintetiza despacho final seguro.', schema, 0.4);
    if (response && typeof response === 'object' && typeof response.mensaje_telegram === 'string') return response;
    if (typeof response === 'string' && typeof Core_parseStructuredJson === 'function') { const parsed = Core_parseStructuredJson(response, { expectedType: 'object' }); if (parsed.ok && parsed.value.mensaje_telegram) return parsed.value; }
  } catch (error) { _orchestratorTelemetry_(context, 'ERROR', '[ORCHESTRATOR] Síntesis LLM degradada.', { error: Core_normalizeError(error).code }); }
  return _orchestratorDegradedOutput_(taskCount);
}

function _orchestratorDegradedOutput_(taskCount) { return { mensaje_telegram: '⚠️ <b>[SRE] Degradación grácil activa.</b><br>El análisis se registró sin acciones no verificadas.', resumen_ejecutivo: 'Ciclo degradado; tareas aprobadas: ' + taskCount + '.' }; }
function _orchestratorBlockActions_(hypothesis, reason) { let clone = {}; try { clone = JSON.parse(JSON.stringify(hypothesis || {})); } catch (ignore) {} clone.tareas_ejecutivas = []; clone.accion_bloqueada = reason; return clone; }
function _orchestratorRequireBudget_(context, minimumMs, phase) { if (Core_remainingBudgetMs(context) < minimumMs) throw new Error('[ORCHESTRATOR_DEADLINE] Presupuesto agotado antes de ' + phase + '.'); }
function _orchestratorTelemetry_(context, severity, message, fields) { if (typeof sendContextualTelemetry === 'function') return sendContextualTelemetry(context, severity, message, fields); if (typeof sendSystemTelemetry === 'function') return sendSystemTelemetry(severity, message, fields); }
function _orchestratorJson_(value, maxChars, fallback) { try { return JSON.stringify(value).substring(0, maxChars); } catch (ignore) { return fallback; } }
function _calculateCognitiveCooldown(sessionEvents, thresholdHours) { const events = Array.isArray(sessionEvents) ? sessionEvents : []; const matches = events.filter(function(event) { return event && event.origin === 'USER_FEEDBACK'; }).sort(function(a, b) { return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(); }); if (!matches.length) return { active: false, hoursSince: 999 }; const hours = (Date.now() - new Date(matches[0].timestamp).getTime()) / 3600000; return { active: hours <= (thresholdHours || 12), hoursSince: Number(hours.toFixed(1)) }; }

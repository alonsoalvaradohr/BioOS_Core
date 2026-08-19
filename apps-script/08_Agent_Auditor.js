/** SPADE: deterministic policy is the first and last authority for Tasks. */
function auditAndValidateHypothesis(specialistName, hypothesis) {
  return executeWithResilience("Auditor_SPADE_" + specialistName, () => {
    const local = _spadeDeterministicValidate(specialistName, hypothesis);
    if (!local.allowed) {
      sendSystemTelemetry("WARNING", "[SPADE] Rechazo local fail-closed: " + local.reasons.join(" | "));
      return local.sanitized;
    }
    const memory = getSystemMemory();
    const rom = memory.ROM;
    const schema = { type: "OBJECT", properties: {
      es_seguro: { type: "BOOLEAN" }, justificacion_auditoria: { type: "STRING" }, hipotesis_corregida: { type: "OBJECT", nullable: true }
    }, required: ["es_seguro", "justificacion_auditoria"] };
    const prompt = String((rom.agent_prompts || {}).auditor || "Auditor SPADE") +
      "\nAplica los axiomas: " + JSON.stringify(rom._safety_invariants || []) +
      "\nLa política local ya aprobó el objeto. No agregues tareas ni acciones. Si existe incertidumbre, es_seguro debe ser false. Dictamen: " + JSON.stringify(local.sanitized);
    let result;
    try { result = invokeUniversalLLM(prompt, "Auditar propuesta ya filtrada por SPADE local.", schema, 0.0); }
    catch (error) {
      sendSystemTelemetry("ERROR", "[SPADE] Auditor LLM no disponible; tareas anuladas: " + error.message);
      return _spadeBlocked(local.sanitized, "AUDITOR_LLM_UNAVAILABLE");
    }
    if (!result || result.es_seguro !== true) {
      sendSystemTelemetry("WARNING", "[SPADE] Auditor LLM rechazó o respondió inválido: " + String((result || {}).justificacion_auditoria || "SIN_JUSTIFICACION"));
      return _spadeBlocked(local.sanitized, "AUDITOR_LLM_REJECTED");
    }
    const candidate = result.hipotesis_corregida || local.sanitized;
    const postValidation = _spadeDeterministicValidate(specialistName, candidate);
    if (!postValidation.allowed) {
      sendSystemTelemetry("WARNING", "[SPADE] Rechazo post-auditor fail-closed: " + postValidation.reasons.join(" | "));
      return postValidation.sanitized;
    }
    sendSystemTelemetry("SUCCESS", "[SPADE] Propuesta aprobada por política local y auditoría LLM.");
    return postValidation.sanitized;
  });
}

function _spadeDeterministicValidate(specialistName, hypothesis) {
  const safe = _spadeClone(hypothesis);
  const reasons = [];
  if (!specialistName || typeof specialistName !== "string" || !safe || Object.prototype.toString.call(safe) !== "[object Object]") {
    return { allowed: false, reasons: ["INVALID_HYPOTHESIS"], sanitized: _spadeBlocked({}, "INVALID_HYPOTHESIS") };
  }
  if (!Array.isArray(safe.tareas_ejecutivas)) reasons.push("TASKS_MISSING_OR_INVALID");
  const prohibited = /(medicaci[oó]n|medicamento|receta|prescrib|dosis|suspende|deja de tomar|ignora.*dolor|entrena.*dolor|autolesi[oó]n|suicid|ayun[oa].{0,20}(?:prolong|extrem)|esteroid|anab[oó]lic|diagnostic[ao]|treatment|medication|dosage|prescrib|ignore.{0,20}pain|self-harm|suicid)/i;
  const tasks = Array.isArray(safe.tareas_ejecutivas) ? safe.tareas_ejecutivas : [];
  if (tasks.length > 3) reasons.push("TASK_LIMIT_EXCEEDED");
  const normalizedTasks = [];
  tasks.forEach((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) { reasons.push("TASK_" + index + "_INVALID"); return; }
    const title = typeof task.titulo === "string" ? task.titulo.trim() : "";
    const notes = typeof task.notas === "string" ? task.notas.trim() : "";
    if (!title || title.length > 240 || notes.length > 2000) { reasons.push("TASK_" + index + "_SHAPE_INVALID"); return; }
    if (prohibited.test(title + " " + notes)) { reasons.push("TASK_" + index + "_PROHIBITED_CONTENT"); return; }
    normalizedTasks.push({ titulo: title, notas: notes });
  });
  if (reasons.length) return { allowed: false, reasons: reasons, sanitized: _spadeBlocked(safe, reasons.join(",")) };
  safe.tareas_ejecutivas = normalizedTasks;
  return { allowed: true, reasons: [], sanitized: safe };
}

function _spadeBlocked(hypothesis, reason) {
  const safe = _spadeClone(hypothesis) || {};
  safe.tareas_ejecutivas = [];
  safe.prescripcion_accionable = "[CENSURADO POR SPADE] Acción automática anulada: " + reason;
  return safe;
}

function _spadeClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }
}

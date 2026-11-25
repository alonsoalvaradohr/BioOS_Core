// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/** SPADE: deterministic policy is the first and last authority for Tasks. */
function auditAndValidateHypothesis(specialistName, hypothesis) {
  return executeWithResilience("Auditor_SPADE_" + specialistName, () => {
    const local = _spadeDeterministicValidate(specialistName, hypothesis);
    if (!local.allowed) {
      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[SPADE] Rechazo local fail-closed: " + local.reasons.join(" | "));
      return local.sanitized;
    }
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("SUCCESS", "[SPADE] Propuesta aprobada por política local determinista.");
    return local.sanitized;
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

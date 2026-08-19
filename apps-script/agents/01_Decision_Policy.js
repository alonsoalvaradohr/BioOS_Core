/**
 * Deterministic decision policy for the cognitive manager.
 *
 * This module is deliberately pure: it does not call an LLM, Apps Script
 * services, telemetry, or storage.  It converts already-normalized evidence
 * into a candidate decision that the separate safety gate and executor may
 * accept or reject.  It is not a clinical diagnostic or an action executor.
 */

var DecisionPolicy_DECISIONS = Object.freeze({
  ACT: 'ACT',
  ASK: 'ASK',
  DEFER: 'DEFER',
  ESCALATE: 'ESCALATE'
});

var DecisionPolicy_REASON = Object.freeze({
  SAFETY_ESCALATION: 'SAFETY_ESCALATION',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  MISSING_EVIDENCE: 'MISSING_EVIDENCE',
  NO_HYPOTHESES: 'NO_HYPOTHESES',
  NO_SUPPORTED_ACTION: 'NO_SUPPORTED_ACTION',
  ACTIONS_NOT_AUTHORIZED: 'ACTIONS_NOT_AUTHORIZED',
  ACTIONS_READY: 'ACTIONS_READY'
});

function DecisionPolicy_decide(input) {
  var model = DecisionPolicy_normalizeInput(input);
  var safetyReasons = DecisionPolicy_collectSafetyReasons(model);
  if (safetyReasons.length) return DecisionPolicy_result(DecisionPolicy_DECISIONS.ESCALATE, safetyReasons, [], []);

  if (model.budget.remainingMs <= 0) {
    return DecisionPolicy_result(DecisionPolicy_DECISIONS.DEFER, [DecisionPolicy_REASON.BUDGET_EXHAUSTED], [], []);
  }

  var missing = DecisionPolicy_collectMissingData(model);
  if (missing.length) {
    return DecisionPolicy_result(DecisionPolicy_DECISIONS.ASK, [DecisionPolicy_REASON.MISSING_EVIDENCE], [], missing);
  }

  if (!model.hypotheses.length) {
    return DecisionPolicy_result(DecisionPolicy_DECISIONS.DEFER, [DecisionPolicy_REASON.NO_HYPOTHESES], [], []);
  }

  var actionIds = DecisionPolicy_collectSupportedActionIds(model);
  if (!actionIds.length) {
    return DecisionPolicy_result(DecisionPolicy_DECISIONS.DEFER, [DecisionPolicy_REASON.NO_SUPPORTED_ACTION], [], []);
  }
  if (!model.budget.allowActions) {
    return DecisionPolicy_result(DecisionPolicy_DECISIONS.DEFER, [DecisionPolicy_REASON.ACTIONS_NOT_AUTHORIZED], [], []);
  }
  return DecisionPolicy_result(DecisionPolicy_DECISIONS.ACT, [DecisionPolicy_REASON.ACTIONS_READY], actionIds, []);
}

function DecisionPolicy_normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('[DECISION_POLICY_INPUT] input debe ser un objeto normalizado.');
  var hypotheses = Array.isArray(input.hypotheses) ? input.hypotheses.slice() : [];
  var evidence = Array.isArray(input.evidence) ? input.evidence.slice() : [];
  var missingData = Array.isArray(input.missingData) ? input.missingData.slice() : [];
  var budget = input.budget && typeof input.budget === 'object' ? input.budget : {};
  hypotheses.forEach(DecisionPolicy_validateHypothesis);
  evidence.forEach(DecisionPolicy_validateEvidence);
  missingData.forEach(function(item) {
    if (typeof item !== 'string' || !item.trim()) throw new Error('[DECISION_POLICY_INPUT] missingData debe contener identificadores no vacíos.');
  });
  if (budget.remainingMs !== undefined && (!isFinite(Number(budget.remainingMs)) || Number(budget.remainingMs) < 0)) {
    throw new Error('[DECISION_POLICY_INPUT] budget.remainingMs debe ser un número no negativo.');
  }
  if (budget.minConfidence !== undefined && (!isFinite(Number(budget.minConfidence)) || Number(budget.minConfidence) < 0 || Number(budget.minConfidence) > 1)) {
    throw new Error('[DECISION_POLICY_INPUT] budget.minConfidence debe estar entre 0 y 1.');
  }
  return {
    hypotheses: hypotheses,
    evidence: evidence,
    missingData: missingData,
    budget: {
      remainingMs: budget.remainingMs === undefined ? 1 : Number(budget.remainingMs),
      minConfidence: budget.minConfidence === undefined ? 0.70 : Number(budget.minConfidence),
      allowActions: budget.allowActions === true
    }
  };
}

function DecisionPolicy_validateHypothesis(hypothesis) {
  if (!hypothesis || typeof hypothesis !== 'object' || Array.isArray(hypothesis)) throw new Error('[DECISION_POLICY_INPUT] hipótesis inválida.');
  if (typeof hypothesis.agentId !== 'string' || !hypothesis.agentId.trim()) throw new Error('[DECISION_POLICY_INPUT] hypothesis.agentId requerido.');
  if (typeof hypothesis.claim !== 'string' || !hypothesis.claim.trim()) throw new Error('[DECISION_POLICY_INPUT] hypothesis.claim requerido.');
  if (!Array.isArray(hypothesis.evidenceIds) || !Array.isArray(hypothesis.missingEvidence) || !Array.isArray(hypothesis.proposedActions)) {
    throw new Error('[DECISION_POLICY_INPUT] hypothesis requiere evidenceIds, missingEvidence y proposedActions como arrays.');
  }
  if (!isFinite(Number(hypothesis.confidence)) || Number(hypothesis.confidence) < 0 || Number(hypothesis.confidence) > 1) {
    throw new Error('[DECISION_POLICY_INPUT] hypothesis.confidence debe estar entre 0 y 1.');
  }
}

function DecisionPolicy_validateEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || typeof evidence.id !== 'string' || !evidence.id.trim()) {
    throw new Error('[DECISION_POLICY_INPUT] evidencia debe incluir id no vacío.');
  }
}

function DecisionPolicy_collectSafetyReasons(model) {
  var reasons = [];
  model.evidence.forEach(function(item) {
    if (item.safetyCritical === true || item.risk === 'critical') reasons.push(DecisionPolicy_REASON.SAFETY_ESCALATION + ':evidence:' + item.id);
  });
  model.hypotheses.forEach(function(item) {
    if (item.requiresEscalation === true || item.risk === 'critical') reasons.push(DecisionPolicy_REASON.SAFETY_ESCALATION + ':hypothesis:' + item.agentId);
  });
  return DecisionPolicy_uniqueSorted(reasons);
}

function DecisionPolicy_collectMissingData(model) {
  var missing = model.missingData.slice();
  model.hypotheses.forEach(function(hypothesis) {
    hypothesis.missingEvidence.forEach(function(item) { missing.push(item); });
  });
  return DecisionPolicy_uniqueSorted(missing.filter(function(item) { return typeof item === 'string' && item.trim(); }));
}

function DecisionPolicy_collectSupportedActionIds(model) {
  var verifiedEvidence = {};
  model.evidence.forEach(function(item) { if (item.verified === true) verifiedEvidence[item.id] = true; });
  var actionIds = [];
  model.hypotheses.forEach(function(hypothesis) {
    var evidenceComplete = hypothesis.evidenceIds.length > 0 && hypothesis.evidenceIds.every(function(id) { return verifiedEvidence[id] === true; });
    var supported = evidenceComplete && hypothesis.missingEvidence.length === 0 && Number(hypothesis.confidence) >= model.budget.minConfidence;
    if (!supported) return;
    hypothesis.proposedActions.forEach(function(action) {
      if (DecisionPolicy_isEligibleAction(action)) actionIds.push(action.id);
    });
  });
  return DecisionPolicy_uniqueSorted(actionIds);
}

function DecisionPolicy_isEligibleAction(action) {
  return !!action && typeof action === 'object' && !Array.isArray(action) &&
    typeof action.id === 'string' && !!action.id.trim() &&
    typeof action.idempotencyKey === 'string' && !!action.idempotencyKey.trim() &&
    action.reversible === true && action.authorized === true;
}

function DecisionPolicy_result(decision, reasons, actionIds, missingData) {
  return Object.freeze({
    decision: decision,
    reasons: Object.freeze(DecisionPolicy_uniqueSorted(reasons)),
    actionIds: Object.freeze(DecisionPolicy_uniqueSorted(actionIds)),
    missingData: Object.freeze(DecisionPolicy_uniqueSorted(missingData))
  });
}

function DecisionPolicy_uniqueSorted(values) {
  var known = {};
  values.forEach(function(value) { known[String(value)] = true; });
  return Object.keys(known).sort();
}

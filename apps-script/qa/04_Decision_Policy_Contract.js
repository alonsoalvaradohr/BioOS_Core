// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/** Isolated contract tests for agents/01_Decision_Policy.js. */
function QA_testDecisionPolicyActsOnlyOnVerifiedReversibleAuthorizedAction() {
  var result = DecisionPolicy_decide({
    hypotheses: [{ agentId: 'fisiologo', claim: 'Recuperación adecuada', evidenceIds: ['e1'], missingEvidence: [], confidence: 0.9,
      proposedActions: [{ id: 'action-rest', idempotencyKey: 'job:1:rest', reversible: true, authorized: true }] }],
    evidence: [{ id: 'e1', verified: true }], missingData: [], budget: { remainingMs: 100, allowActions: true }
  });
  QA_assert(result.decision === 'ACT' && result.actionIds.length === 1 && result.actionIds[0] === 'action-rest',
    'Solo una acción verificable, reversible y autorizada puede llegar a ACT.');
}

function QA_testDecisionPolicyAsksBeforeActingWhenDataIsMissing() {
  var result = DecisionPolicy_decide({
    hypotheses: [{ agentId: 'somnologo', claim: 'Dato incompleto', evidenceIds: ['e1'], missingEvidence: ['sleep.duration'], confidence: 0.99, proposedActions: [] }],
    evidence: [{ id: 'e1', verified: true }], missingData: ['hrv.baseline'], budget: { remainingMs: 100, allowActions: true }
  });
  QA_assert(result.decision === 'ASK' && result.missingData.join(',') === 'hrv.baseline,sleep.duration',
    'Datos faltantes deben generar ASK determinista antes de actuar.');
}

function QA_testDecisionPolicyEscalatesSafetySignal() {
  var result = DecisionPolicy_decide({ hypotheses: [], evidence: [{ id: 'e-critical', verified: true, safetyCritical: true }], missingData: [], budget: { remainingMs: 100, allowActions: true } });
  QA_assert(result.decision === 'ESCALATE' && result.actionIds.length === 0,
    'Una señal crítica debe vetar ACT y producir ESCALATE.');
}

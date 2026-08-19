/** Pure contract tests: no Drive, Sheet, lock, network, or clock service. */
function QA_testCognitiveContractsFailClosed() {
  var now = Date.parse('2030-01-01T00:00:00.000Z');
  var hypothesis = Cog_validateHypothesis({
    id: 'hyp-1', statement: 'El descanso bajo puede afectar la recuperacion.', evidenceIds: ['sensor:sleep:1'],
    confidence: 0.72, source: 'sensor-service', createdAt: '2029-12-31T00:00:00.000Z',
    expiresAt: '2030-01-02T00:00:00.000Z', idempotencyKey: 'hypothesis:1'
  }, now);
  QA_assert(hypothesis.ok, 'Una hipotesis completa debe ser valida.');

  var actWithoutAction = Cog_validateDecision({
    id: 'dec-1', hypothesisId: 'hyp-1', state: 'ACT', rationale: 'Prueba controlada.', evidenceIds: ['sensor:sleep:1'],
    confidence: 0.72, createdAt: '2029-12-31T00:00:00.000Z', expiresAt: '2030-01-02T00:00:00.000Z', idempotencyKey: 'decision:1'
  }, now);
  QA_assert(!actWithoutAction.ok && actWithoutAction.errors.indexOf('DECISION_ACT_ACTION_INVALID') !== -1,
    'ACT sin accion idempotente debe fallar cerrado.');

  var decision = Cog_validateDecision({
    id: 'dec-2', hypothesisId: 'hyp-1', state: 'ASK', rationale: 'Hace falta confirmar contexto.', evidenceIds: ['sensor:sleep:1'],
    confidence: 0.72, createdAt: '2029-12-31T00:00:00.000Z', expiresAt: '2030-01-02T00:00:00.000Z',
    idempotencyKey: 'decision:2', question: '¿Como te sentiste al despertar?'
  }, now);
  QA_assert(decision.ok, 'ASK con pregunta debe ser valida.');
  var outcome = Cog_validateOutcome({
    id: 'out-1', decisionId: 'dec-2', status: 'OBSERVED', summary: 'Usuario reporta fatiga moderada.',
    evidenceIds: ['telegram:message:1'], confidence: 0.9, observedAt: '2030-01-01T01:00:00.000Z',
    expiresAt: '2030-01-02T00:00:00.000Z', idempotencyKey: 'outcome:1'
  }, now);
  QA_assert(outcome.ok, 'Un outcome trazable debe ser valido.');
}

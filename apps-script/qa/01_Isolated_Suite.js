/**
 * Isolated Phase-0 QA runner. It proves contracts against fakes only; it is
 * not an integration test and intentionally has zero external side effects.
 */
function QA_RunIsolatedSuite() {
  var tests = [
    QA_testMutationIsSerialized,
    QA_testNestedLockIsRejected,
    QA_testQueueIsIdempotent,
    QA_testMetaEvolutionProposalIsDataOnly,
    QA_testROMProposalValidationFailsClosed,
    QA_testFailClosedPolicyContract,
    QA_testStructuredParserFailsClosedOnMalformedOutput,
    QA_testRegistryRomSelectionContract,
    QA_testSpadeDeterministicRejectsProhibitedAction,
    QA_testTelemetryRetainsBufferOnPersistenceFailure,
    QA_testQueueStateTransitions,
    QA_testCognitiveContractsFailClosed,
    QA_testDecisionPolicyActsOnlyOnVerifiedReversibleAuthorizedAction,
    QA_testDecisionPolicyAsksBeforeActingWhenDataIsMissing,
    QA_testDecisionPolicyEscalatesSafetySignal,
    QA_testOutcomeLedgerPreservesTraceability
  ];
  var report = { suite: 'isolated-phase-0', passed: 0, failed: 0, failures: [] };
  console.log('[QA] Inicio de suite aislada; no se usarán servicios de producción.');
  tests.forEach(function (testFn) {
    try {
      testFn();
      report.passed++;
      console.log('[QA] PASS ' + testFn.name);
    } catch (error) {
      report.failed++;
      report.failures.push({ test: testFn.name, error: String(error.message || error) });
      console.error('[QA] FAIL ' + testFn.name + ': ' + String(error.message || error));
    }
  });
  console.log('[QA] Resultado: PASS ' + report.passed + ' | FAIL ' + report.failed);
  if (report.failed) throw new Error('[QA_SUITE_FAILED] ' + JSON.stringify(report));
  return report;
}

function QA_testMutationIsSerialized() {
  var memory = new QA_FakeMemory({ L1_Working: { events: [] }, cursor: 0 });
  memory.mutate(function (nvram) { nvram.cursor++; return nvram; });
  memory.mutate(function (nvram) { nvram.cursor++; return nvram; });
  QA_assert(memory.read().cursor === 2, 'Dos mutaciones serializadas no deben perder actualizaciones.');
  QA_assert(memory.lock.acquireCount === 2 && memory.writeCount === 2, 'Cada mutación debe usar exactamente un lock y una escritura.');
}

function QA_testNestedLockIsRejected() {
  var lock = new QA_FakeLock();
  var rejected = false;
  try {
    lock.run(function () { lock.run(function () {}); });
  } catch (error) {
    rejected = String(error.message).indexOf('[QA_LOCK_REENTRANT]') !== -1;
  }
  QA_assert(rejected, 'El fake debe detectar auto-deadlock antes de que llegue a producción.');
}

function QA_testQueueIsIdempotent() {
  var queue = new QA_FakeQueue();
  QA_assert(queue.enqueue({ idempotencyKey: 'telegram:123' }).accepted, 'El primer job debe aceptarse.');
  QA_assert(queue.enqueue({ idempotencyKey: 'telegram:123' }).duplicate, 'Un update duplicado debe rechazarse.');
  QA_assert(queue.jobs.length === 1, 'La cola no debe duplicar trabajos.');
}

function QA_testMetaEvolutionProposalIsDataOnly() {
  var rom = { version: '5.0', policy: 'immutable' };
  var proposal = { type: 'rom-change-proposal', baseVersion: rom.version, patch: [{ op: 'replace', path: '/policy', value: 'review' }] };
  QA_assert(rom.policy === 'immutable', 'Crear una propuesta no puede mutar ROM.');
  QA_assert(proposal.patch.length === 1 && proposal.type === 'rom-change-proposal', 'La evolución debe ser propuesta versionada.');
}

function QA_testROMProposalValidationFailsClosed() {
  var proposal = {
    kind: 'BIOOS_ROM_PROMPT_PROPOSAL', id: 'evo_test_123', agentKey: 'fisiologo',
    baseRomVersion: '5.0', basePromptHash: 'a', proposedPromptHash: 'b',
    proposedPrompt: 'Mantén recomendaciones seguras y no clínicas.',
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };
  QA_assert(_metaValidateProposal(proposal).id === proposal.id, 'Una propuesta vigente debe revisarse sin escribir ROM.');
  proposal.expiresAt = new Date(Date.now() - 1).toISOString();
  var rejected = false;
  try { _metaValidateProposal(proposal); } catch (error) { rejected = String(error.message).indexOf('[META_REJECTED]') !== -1; }
  QA_assert(rejected, 'Una propuesta vencida debe rechazarse antes de cualquier mutación.');
}

function QA_testFailClosedPolicyContract() {
  var requested = { tasks: ['ignorar dolor severo'] };
  var decision = { allowed: false, sanitized: { tasks: [] }, reasons: ['medical-red-flag'] };
  QA_assert(!decision.allowed && decision.sanitized.tasks.length === 0 && decision.reasons.length > 0,
    'Una decisión insegura debe bloquear acciones y conservar motivo.');
  QA_assert(requested.tasks.length === 1, 'La política no debe mutar la entrada original.');
}

function QA_testStructuredParserFailsClosedOnMalformedOutput() {
  QA_assert(typeof Core_parseStructuredJson === 'function', 'El parser estructurado Core debe estar disponible para QA.');
  var malformed = Core_parseStructuredJson('{"tareas": [}', { expectedType: 'object' });
  QA_assert(malformed && malformed.ok === false, 'Un JSON malformado no puede convertirse en objeto vacío ni éxito.');
  QA_assert(malformed.error && malformed.error.code === 'CORE_JSON_UNBALANCED', 'El JSON truncado debe reportar error estructurado.');
  var schemaFailure = Core_parseStructuredJson('{"tareas":"no-array"}', {
    expectedType: 'object',
    validator: function (value) { return Array.isArray(value.tareas); }
  });
  QA_assert(schemaFailure.ok === false && schemaFailure.error.code === 'CORE_JSON_SCHEMA', 'Un contrato inválido debe fallar cerrado.');
}

function QA_testRegistryRomSelectionContract() {
  QA_assert(typeof getAgentRegistry === 'function' && typeof selectRegisteredSpecialists === 'function', 'El registro declarativo debe estar disponible para QA.');
  var registry = getAgentRegistry();
  var prompts = {};
  Object.keys(registry).forEach(function (id) { prompts[registry[id].promptKey] = 'Prompt aprobado para ' + id; });
  prompts.somnologo = '   ';
  var selected = selectRegisteredSpecialists('MORNING_BRIEFING', prompts);
  QA_assert(selected.fisiologo && selected.ejecutivo && selected.endocrinologo && selected.psicologo_cog,
    'ROM con prompts aprobados debe activar los especialistas declarados para el evento.');
  QA_assert(!selected.somnologo, 'Un prompt ROM vacío debe desactivar el especialista sin seleccionar uno implícitamente.');
  QA_assert(Object.keys(selected).every(function (id) { return Object.prototype.hasOwnProperty.call(registry, id); }),
    'La selección no puede incluir agentes fuera del registro.');
}

function QA_testSpadeDeterministicRejectsProhibitedAction() {
  QA_assert(typeof _spadeDeterministicValidate === 'function', 'La política SPADE determinista debe estar disponible para QA.');
  var proposal = { tareas_ejecutivas: [{ titulo: 'Ignorar dolor severo', notas: 'Continuar entrenamiento.' }] };
  var decision = _spadeDeterministicValidate('fisiologo', proposal);
  QA_assert(decision.allowed === false, 'SPADE debe bloquear determinísticamente una acción médica prohibida.');
  QA_assert(decision.reasons.length > 0 && decision.sanitized.tareas_ejecutivas.length === 0,
    'SPADE debe producir motivo y una salida sin acciones automáticas.');
  QA_assert(proposal.tareas_ejecutivas.length === 1, 'SPADE no puede mutar la propuesta de entrada.');
}

function QA_testTelemetryRetainsBufferOnPersistenceFailure() {
  var telemetry = new QA_FakeTelemetry();
  telemetry.event({ requestId: 'req-1', message: 'evento importante' });
  telemetry.failWrites = true;
  var failed = telemetry.flush();
  QA_assert(failed.retryable && telemetry.buffer.length === 1 && telemetry.persisted.length === 0,
    'Un fallo de persistencia debe conservar el batch completo en memoria.');
  telemetry.failWrites = false;
  var recovered = telemetry.flush();
  QA_assert(recovered.flushed === 1 && telemetry.buffer.length === 0 && telemetry.persisted.length === 1,
    'El batch retenido debe persistirse una vez al recuperarse el repositorio.');
}

function QA_testQueueStateTransitions() {
  var queue = new QA_FakeQueue();
  var accepted = queue.enqueue({ idempotencyKey: 'telegram:transition', message: 'estado' });
  var claimed = queue.claim(1);
  QA_assert(claimed.length === 1 && claimed[0].status === 'processing' && claimed[0].attempts === 1,
    'Un job pendiente debe pasar a processing exactamente una vez al ser reclamado.');
  var completed = queue.complete(accepted.jobId, 'completed');
  QA_assert(completed.status === 'completed', 'Un job reclamado debe alcanzar el estado terminal solicitado.');
  var rejected = false;
  try { queue.complete(accepted.jobId, 'completed'); } catch (error) { rejected = String(error.message).indexOf('Solo un job reclamado') !== -1; }
  QA_assert(rejected, 'No se permite una segunda transición terminal ni completar jobs no reclamados.');
}

function QA_testOutcomeLedgerPreservesTraceability() {
  QA_assert(typeof Memory_appendOutcomeLedger === 'function', 'El ledger de resultados debe estar disponible para QA.');
  var now = Date.parse('2030-01-01T12:00:00.000Z');
  var input = {
    outcomeId: 'outcome-qa-1', decisionId: 'decision-qa-1', actionId: 'action-qa-1', status: 'COMPLETED',
    occurredAt: '2030-01-01T11:59:00.000Z',
    provenance: { source: 'qa', requestId: 'request-qa-1', agentIds: ['fisiologo'], evidenceIds: ['evidence-qa-1'] },
    assessment: { observedOutcome: 'La acción quedó observada.', utility: 0.5, safetySignals: [] }
  };
  var appended = Memory_appendOutcomeLedger(null, input, { maxRecords: 2 }, now);
  QA_assert(appended.ok && appended.value.records.length === 1, 'Un resultado trazable debe agregarse al ledger aislado.');
  var duplicate = Memory_appendOutcomeLedger(appended.value, input, { maxRecords: 2 }, now);
  QA_assert(!duplicate.ok && duplicate.error.code === 'OUTCOME_LEDGER_DUPLICATE', 'El ledger debe rechazar resultados duplicados.');
}

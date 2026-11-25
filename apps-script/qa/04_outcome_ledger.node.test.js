// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/* Node-only contract tests for the pure outcome-ledger bridge. */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var fs = require('fs');
  var vm = require('vm');
  var path = require('path');
  var source = fs.readFileSync(path.join(__dirname, '..', 'memory', '01_Outcome_Ledger.js'), 'utf8');
  var context = { Date: Date, JSON: JSON, Object: Object, String: String, Number: Number, Array: Array, Math: Math, isFinite: isFinite };
  vm.createContext(context);
  vm.runInContext(source, context);
  var now = Date.parse('2026-08-19T12:00:00.000Z');
  var input = {
    outcomeId: 'out-1', decisionId: 'decision-1', actionId: 'task-1', status: 'COMPLETED', occurredAt: '2026-08-19T11:59:00.000Z',
    provenance: { source: 'telegram', requestId: 'req-1', agentIds: ['fisiologo'], evidenceIds: ['event-1'] },
    assessment: { observedOutcome: 'La tarea se completó.', utility: 0.5, safetySignals: [] }
  };
  var prepared = context.Memory_prepareOutcomeRecord(input, { maxRecords: 2 }, now);
  if (!prepared.ok || prepared.value.provenance.requestId !== 'req-1') throw new Error('No preservó proveniencia.');
  var appended = context.Memory_appendOutcomeLedger(null, input, { maxRecords: 1 }, now);
  if (!appended.ok || appended.value.records.length !== 1) throw new Error('No agregó el resultado.');
  var duplicate = context.Memory_appendOutcomeLedger(appended.value, input, { maxRecords: 1 }, now);
  if (duplicate.ok || duplicate.error.code !== 'OUTCOME_LEDGER_DUPLICATE') throw new Error('No rechazó duplicado.');
  var pruned = context.Memory_pruneOutcomeLedger(appended.value, { maxRecords: 1 }, now + 91 * 24 * 60 * 60 * 1000);
  if (!pruned.ok || pruned.value.records.length !== 0) throw new Error('No respetó retención.');
  console.log('Outcome ledger contract tests: PASS');
}

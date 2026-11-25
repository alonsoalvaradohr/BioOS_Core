// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/* Node-only contract test. Apps Script loads this file as a no-op. */
if (typeof require !== 'undefined') {
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '..', '02_Mem_Hierarchical.js'), 'utf8');
const context = { console, BIOOS_CONFIG: { BIOMETRY: { BASELINE_RHR: 43, TARGET_STEPS: 8000 }, MEMORY_LIMITS: { COMPACTION_THRESHOLD_PCT: .75 } } };
vm.createContext(context); vm.runInContext(source, context);
function assert(ok, message) { if (!ok) throw new Error(message); }
function run(name, fn) { try { fn(); console.log('PASS ' + name); return true; } catch (e) { console.error('FAIL ' + name + ': ' + e.message); return false; } }
let pass = 0, fail = 0;
function test(name, fn) { if (run(name, fn)) pass++; else fail++; }
test('migration preserves existing data and supplies missing partitions', () => {
  const migrated = context._memMigrateNVRAM({ L1_Working: { session_events: [{ id: 7 }] }, L2_Episodic: {} });
  assert(migrated.L1_Working.session_events[0].id === 7, 'migration reset L1');
  assert(migrated.L3_Semantic && migrated.L4_Basal && migrated._bioos_memory_schema === 2, 'migration incomplete');
});
test('hard limits retain newest records only', () => {
  const s = context._memMigrateNVRAM({ L1_Working: { session_events: Array.from({ length: 12 }, (_, i) => i) }, L2_Episodic: { weekly_archives: Array.from({ length: 54 }, (_, i) => i), raw_data_lake: Array.from({ length: 252 }, (_, i) => i) } });
  const limited = context._memApplyHardLimits(s);
  assert(limited.L1_Working.session_events.length === 10 && limited.L1_Working.session_events[0] === 2, 'L1 not bounded');
  assert(limited.L2_Episodic.weekly_archives.length === 52 && limited.L2_Episodic.raw_data_lake.length === 250, 'L2 not bounded');
});
test('recovery envelope rejects changed state', () => {
  const envelope = context._memCreateEnvelope(context._memDefaultState(), 4);
  assert(context._memValidateEnvelope(envelope).generation === 4, 'valid envelope rejected');
  envelope.state.L4_Basal.target_steps = 1;
  let rejected = false; try { context._memValidateEnvelope(envelope); } catch (_) { rejected = true; }
  assert(rejected, 'tampered envelope accepted');
});
console.log('Memory-store Node QA: PASS ' + pass + ' | FAIL ' + fail);
if (fail) process.exitCode = 1;
}

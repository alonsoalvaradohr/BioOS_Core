// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/**
 * LEGACY QA ENTRYPOINT (PRODUCTION SAFETY GUARD)
 *
 * This file used to create/delete real ScriptApp triggers, edit the production
 * Queue_NLP sheet and monkey-patch Apps Script services. It is intentionally
 * disabled. Use QA_RunIsolatedSuite() from qa/01_Isolated_Suite.js instead.
 * The isolated entrypoint covers memory, queue lifecycle, structured parsing,
 * registry/ROM routing, deterministic SPADE, and telemetry retention via fakes.
 */
function runSRETestSuite() {
  throw new Error(
    '[QA_PRODUCTION_BLOCKED] La suite heredada no se puede ejecutar contra recursos productivos. ' +
    'Ejecute QA_RunIsolatedSuite(); usa fakes en memoria y no llama Drive, Sheets, Tasks, Triggers ni red.'
  );
}

/** Kept only as an explicit migration hint for existing run configurations. */
function runLegacySRETestSuite() {
  return runSRETestSuite();
}

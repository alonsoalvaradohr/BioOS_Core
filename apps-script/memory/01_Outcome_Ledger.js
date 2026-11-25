// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/**
 * Pure outcome-ledger bridge.
 *
 * This module deliberately has no Drive, Properties, Lock, Sheets, or other
 * Apps Script service dependency. It prepares and validates bounded outcome
 * records so a later memory-store integration can persist them through the
 * single transactional NVRAM mutation boundary.
 *
 * It does not infer utility, make clinical judgments, or change policies.
 */

var MEMORY_OUTCOME_LEDGER_SCHEMA_VERSION = 1;
var MEMORY_OUTCOME_LEDGER_DEFAULT_MAX_RECORDS = 200;
var MEMORY_OUTCOME_LEDGER_MAX_RECORDS = 1000;
var MEMORY_OUTCOME_LEDGER_DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
var MEMORY_OUTCOME_LEDGER_MAX_TEXT_LENGTH = 1200;

/**
 * Creates a bounded, immutable outcome record. `nowMs` is injectable for
 * deterministic tests. No system services are read or written.
 */
function Memory_prepareOutcomeRecord(input, policy, nowMs) {
  var normalizedPolicy = Memory_normalizeOutcomePolicy_(policy);
  var timestampMs = Number(nowMs || Date.now());
  if (!isFinite(timestampMs) || timestampMs <= 0) {
    return Memory_outcomeError_('OUTCOME_CLOCK_INVALID', 'El reloj de preparación no es válido.');
  }
  if (!input || Object.prototype.toString.call(input) !== '[object Object]') {
    return Memory_outcomeError_('OUTCOME_INVALID_INPUT', 'El resultado debe ser un objeto.');
  }

  var outcomeId = Memory_outcomeRequiredId_(input.outcomeId, 'outcomeId');
  var decisionId = Memory_outcomeRequiredId_(input.decisionId, 'decisionId');
  var actionId = Memory_outcomeRequiredId_(input.actionId, 'actionId');
  var status = String(input.status || '').toUpperCase();
  var allowedStatuses = { OBSERVED: true, COMPLETED: true, FAILED: true, CANCELLED: true, UNKNOWN: true };
  if (!outcomeId || !decisionId || !actionId || !allowedStatuses[status]) {
    return Memory_outcomeError_('OUTCOME_CONTRACT_INVALID', 'outcomeId, decisionId, actionId y status válido son obligatorios.');
  }

  var occurredAtMs = Memory_outcomeTimestamp_(input.occurredAt, timestampMs);
  if (!occurredAtMs || occurredAtMs > timestampMs + 5 * 60 * 1000) {
    return Memory_outcomeError_('OUTCOME_TIMESTAMP_INVALID', 'occurredAt debe ser una fecha válida y no futura.');
  }
  var provenance = Memory_normalizeOutcomeProvenance_(input.provenance);
  if (!provenance.ok) return provenance;
  var assessment = Memory_normalizeOutcomeAssessment_(input.assessment);
  if (!assessment.ok) return assessment;

  var retentionMs = Memory_outcomeRetention_(input.retentionMs, normalizedPolicy.retentionMs);
  if (!retentionMs) return Memory_outcomeError_('OUTCOME_RETENTION_INVALID', 'La retención solicitada no es válida.');
  var record = {
    schemaVersion: MEMORY_OUTCOME_LEDGER_SCHEMA_VERSION,
    outcomeId: outcomeId,
    decisionId: decisionId,
    actionId: actionId,
    status: status,
    occurredAt: new Date(occurredAtMs).toISOString(),
    recordedAt: new Date(timestampMs).toISOString(),
    expiresAt: new Date(timestampMs + retentionMs).toISOString(),
    provenance: provenance.value,
    assessment: assessment.value
  };
  return Memory_outcomeOk_(Memory_freezeOutcome_(record));
}

/**
 * Validates a serializable ledger snapshot and returns a clean immutable copy.
 * Expired entries are rejected here; pruning is explicit in append/prune APIs.
 */
function Memory_validateOutcomeLedger(ledger, policy, nowMs) {
  var normalizedPolicy = Memory_normalizeOutcomePolicy_(policy);
  var timestampMs = Number(nowMs || Date.now());
  if (!ledger || Object.prototype.toString.call(ledger) !== '[object Object]' || !Array.isArray(ledger.records)) {
    return Memory_outcomeError_('OUTCOME_LEDGER_INVALID', 'El ledger debe contener un arreglo records.');
  }
  if (ledger.records.length > normalizedPolicy.maxRecords) {
    return Memory_outcomeError_('OUTCOME_LEDGER_OVER_CAPACITY', 'El ledger excede el límite configurado.');
  }
  var seen = {};
  var records = [];
  for (var index = 0; index < ledger.records.length; index++) {
    var persisted = ledger.records[index];
    var recordedAtMs = Memory_outcomeTimestamp_(persisted && persisted.recordedAt, 0);
    var expiresAtMs = Memory_outcomeTimestamp_(persisted && persisted.expiresAt, 0);
    var persistedRetentionMs = expiresAtMs - recordedAtMs;
    if (!recordedAtMs || !expiresAtMs || !Memory_outcomeRetention_(persistedRetentionMs, 0)) {
      return Memory_outcomeError_('OUTCOME_LEDGER_RECORD_INVALID', 'Registro inválido en posición ' + index + ': timestamps de persistencia inválidos.');
    }
    var prepared = Memory_prepareOutcomeRecord(persisted, {
      maxRecords: normalizedPolicy.maxRecords,
      retentionMs: persistedRetentionMs
    }, recordedAtMs);
    if (!prepared.ok) return Memory_outcomeError_('OUTCOME_LEDGER_RECORD_INVALID', 'Registro inválido en posición ' + index + ': ' + prepared.error.message);
    var record = prepared.value;
    if (record.recordedAt !== persisted.recordedAt || record.expiresAt !== persisted.expiresAt) {
      return Memory_outcomeError_('OUTCOME_LEDGER_RECORD_INVALID', 'Registro inválido en posición ' + index + ': envelope de tiempo inconsistente.');
    }
    if (seen[record.outcomeId]) return Memory_outcomeError_('OUTCOME_LEDGER_DUPLICATE', 'outcomeId duplicado: ' + record.outcomeId);
    if (Date.parse(record.expiresAt) <= timestampMs) return Memory_outcomeError_('OUTCOME_LEDGER_EXPIRED_RECORD', 'El ledger contiene un registro vencido.');
    seen[record.outcomeId] = true;
    records.push(record);
  }
  return Memory_outcomeOk_(Memory_freezeOutcome_({
    schemaVersion: MEMORY_OUTCOME_LEDGER_SCHEMA_VERSION,
    records: records
  }));
}

/**
 * Produces the next ledger state without persistence. It removes expired
 * records, enforces a fixed capacity, and rejects duplicate outcomes.
 */
function Memory_appendOutcomeLedger(ledger, input, policy, nowMs) {
  var normalizedPolicy = Memory_normalizeOutcomePolicy_(policy);
  var timestampMs = Number(nowMs || Date.now());
  var current = ledger || { schemaVersion: MEMORY_OUTCOME_LEDGER_SCHEMA_VERSION, records: [] };
  if (!current || !Array.isArray(current.records)) return Memory_outcomeError_('OUTCOME_LEDGER_INVALID', 'El estado actual del ledger no es válido.');
  var recordResult = Memory_prepareOutcomeRecord(input, normalizedPolicy, timestampMs);
  if (!recordResult.ok) return recordResult;

  var kept = [];
  for (var index = 0; index < current.records.length; index++) {
    var existing = current.records[index];
    if (!existing || Date.parse(existing.expiresAt) <= timestampMs) continue;
    if (String(existing.outcomeId) === recordResult.value.outcomeId) {
      return Memory_outcomeError_('OUTCOME_LEDGER_DUPLICATE', 'El resultado ya fue registrado: ' + recordResult.value.outcomeId);
    }
    kept.push(Memory_outcomeClone_(existing));
  }
  kept.push(recordResult.value);
  kept.sort(function(a, b) { return Date.parse(a.recordedAt) - Date.parse(b.recordedAt); });
  while (kept.length > normalizedPolicy.maxRecords) kept.shift();
  return Memory_outcomeOk_(Memory_freezeOutcome_({
    schemaVersion: MEMORY_OUTCOME_LEDGER_SCHEMA_VERSION,
    records: kept
  }));
}

/** Explicit, pure retention operation for a persistence adapter. */
function Memory_pruneOutcomeLedger(ledger, policy, nowMs) {
  var normalizedPolicy = Memory_normalizeOutcomePolicy_(policy);
  var timestampMs = Number(nowMs || Date.now());
  if (!ledger || !Array.isArray(ledger.records)) return Memory_outcomeError_('OUTCOME_LEDGER_INVALID', 'El ledger no contiene records.');
  var kept = ledger.records.filter(function(record) {
    return record && isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) > timestampMs;
  });
  kept.sort(function(a, b) { return Date.parse(a.recordedAt) - Date.parse(b.recordedAt); });
  while (kept.length > normalizedPolicy.maxRecords) kept.shift();
  return Memory_outcomeOk_(Memory_freezeOutcome_({ schemaVersion: MEMORY_OUTCOME_LEDGER_SCHEMA_VERSION, records: kept }));
}

function Memory_normalizeOutcomePolicy_(policy) {
  policy = policy || {};
  var maxRecords = Math.floor(Number(policy.maxRecords || MEMORY_OUTCOME_LEDGER_DEFAULT_MAX_RECORDS));
  maxRecords = Math.min(MEMORY_OUTCOME_LEDGER_MAX_RECORDS, Math.max(1, isFinite(maxRecords) ? maxRecords : MEMORY_OUTCOME_LEDGER_DEFAULT_MAX_RECORDS));
  var retentionMs = Number(policy.retentionMs || MEMORY_OUTCOME_LEDGER_DEFAULT_RETENTION_MS);
  retentionMs = Math.min(365 * 24 * 60 * 60 * 1000, Math.max(60 * 1000, isFinite(retentionMs) ? retentionMs : MEMORY_OUTCOME_LEDGER_DEFAULT_RETENTION_MS));
  return { maxRecords: maxRecords, retentionMs: retentionMs };
}

function Memory_normalizeOutcomeProvenance_(provenance) {
  provenance = provenance || {};
  var source = Memory_outcomeRequiredId_(provenance.source, 'provenance.source');
  var requestId = Memory_outcomeRequiredId_(provenance.requestId, 'provenance.requestId');
  var agentIds = Array.isArray(provenance.agentIds) ? provenance.agentIds.map(function(id) { return Memory_outcomeRequiredId_(id, 'agentId'); }).filter(Boolean) : [];
  var evidenceIds = Array.isArray(provenance.evidenceIds) ? provenance.evidenceIds.map(function(id) { return Memory_outcomeRequiredId_(id, 'evidenceId'); }).filter(Boolean) : [];
  if (!source || !requestId || !agentIds.length) return Memory_outcomeError_('OUTCOME_PROVENANCE_INVALID', 'La proveniencia requiere source, requestId y al menos un agentId.');
  return Memory_outcomeOk_({ source: source, requestId: requestId, agentIds: agentIds, evidenceIds: evidenceIds });
}

function Memory_normalizeOutcomeAssessment_(assessment) {
  assessment = assessment || {};
  var observedOutcome = String(assessment.observedOutcome || '').trim();
  if (!observedOutcome || observedOutcome.length > MEMORY_OUTCOME_LEDGER_MAX_TEXT_LENGTH) {
    return Memory_outcomeError_('OUTCOME_ASSESSMENT_INVALID', 'assessment.observedOutcome es obligatorio y tiene un límite de longitud.');
  }
  var utility = assessment.utility;
  if (utility !== undefined && (!isFinite(Number(utility)) || Number(utility) < -1 || Number(utility) > 1)) {
    return Memory_outcomeError_('OUTCOME_ASSESSMENT_INVALID', 'assessment.utility debe estar entre -1 y 1.');
  }
  var safetySignals = Array.isArray(assessment.safetySignals) ? assessment.safetySignals.map(String).slice(0, 20) : [];
  return Memory_outcomeOk_({ observedOutcome: observedOutcome, utility: utility === undefined ? null : Number(utility), safetySignals: safetySignals });
}

function Memory_outcomeRequiredId_(value) {
  var id = String(value || '').trim();
  return /^[A-Za-z0-9_.:@-]{1,160}$/.test(id) ? id : '';
}

function Memory_outcomeTimestamp_(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  var parsed = typeof value === 'number' ? value : Date.parse(value);
  return isFinite(parsed) && parsed > 0 ? Number(parsed) : 0;
}

function Memory_outcomeRetention_(requested, fallback) {
  var value = Number(requested === undefined ? fallback : requested);
  return isFinite(value) && value >= 60 * 1000 && value <= 365 * 24 * 60 * 60 * 1000 ? value : 0;
}

function Memory_outcomeClone_(value) { return JSON.parse(JSON.stringify(value)); }
function Memory_freezeOutcome_(value) { return Object.freeze(Memory_outcomeClone_(value)); }
function Memory_outcomeOk_(value) { return Object.freeze({ ok: true, value: value }); }
function Memory_outcomeError_(code, message) { return Object.freeze({ ok: false, error: Object.freeze({ code: code, message: message }) }); }

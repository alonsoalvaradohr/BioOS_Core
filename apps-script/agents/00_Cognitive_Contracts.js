// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/**
 * Pure, fail-closed contracts for the cognitive kernel.  These functions do
 * not call Apps Script services, generate identifiers, read the clock, or
 * execute actions.  The orchestration layer must supply durable IDs and an
 * explicit `nowMs` when it needs to determine whether a record is expired.
 *
 * @typedef {{
 *   id: string, statement: string, evidenceIds: string[], confidence: number,
 *   source: string, createdAt: string, expiresAt: string, idempotencyKey: string
 * }} Cog_Hypothesis
 *
 * @typedef {{
 *   id: string, hypothesisId: string, state: 'ACT'|'ASK'|'DEFER'|'ESCALATE',
 *   rationale: string, evidenceIds: string[], confidence: number,
 *   createdAt: string, expiresAt: string, idempotencyKey: string,
 *   action: (Object|undefined), question: (string|undefined),
 *   reviewAt: (string|undefined), escalation: (Object|undefined)
 * }} Cog_Decision
 *
 * @typedef {{
 *   id: string, decisionId: string, status: 'OBSERVED'|'SUCCEEDED'|'FAILED'|'CANCELLED',
 *   summary: string, evidenceIds: string[], confidence: number,
 *   observedAt: string, expiresAt: string, idempotencyKey: string
 * }} Cog_Outcome
 *
 * @typedef {{ok: true, value: *, errors: string[]}|{ok: false, value: *, errors: string[]}} Cog_Validation
 */

var COG_DECISION_STATE = Object.freeze({
  ACT: 'ACT', ASK: 'ASK', DEFER: 'DEFER', ESCALATE: 'ESCALATE'
});

var COG_OUTCOME_STATUS = Object.freeze({
  OBSERVED: 'OBSERVED', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', CANCELLED: 'CANCELLED'
});

/** Normalizes a proposed hypothesis without inventing missing safety fields. */
function Cog_normalizeHypothesis(input) {
  return Cog_normalizeRecord_(input, ['id', 'statement', 'source', 'createdAt', 'expiresAt', 'idempotencyKey']);
}

/** Normalizes a proposed decision without changing its state or authorizing it. */
function Cog_normalizeDecision(input) {
  var value = Cog_normalizeRecord_(input, ['id', 'hypothesisId', 'state', 'rationale', 'createdAt', 'expiresAt', 'idempotencyKey']);
  var source = Cog_plainObject_(input) ? input : {};
  value.state = Cog_text_(value.state).toUpperCase();
  value.question = Cog_text_(source.question);
  value.reviewAt = Cog_text_(source.reviewAt);
  value.action = Cog_plainObject_(source.action) ? Cog_clone_(source.action) : null;
  value.escalation = Cog_plainObject_(source.escalation) ? Cog_clone_(source.escalation) : null;
  return value;
}

/** Normalizes a recorded outcome without asserting that it is trustworthy. */
function Cog_normalizeOutcome(input) {
  var value = Cog_normalizeRecord_(input, ['id', 'decisionId', 'status', 'summary', 'observedAt', 'expiresAt', 'idempotencyKey']);
  value.status = Cog_text_(value.status).toUpperCase();
  return value;
}

/** @return {Cog_Validation} */
function Cog_validateHypothesis(input, nowMs) {
  var value = Cog_normalizeHypothesis(input);
  var errors = Cog_validateCommon_(value, nowMs, 'createdAt');
  if (!Cog_inRange_(value.statement.length, 1, 2000)) errors.push('HYPOTHESIS_STATEMENT_INVALID');
  if (!Cog_inRange_(value.source.length, 1, 128)) errors.push('HYPOTHESIS_SOURCE_INVALID');
  return Cog_validation_(value, errors);
}

/** @return {Cog_Validation} */
function Cog_validateDecision(input, nowMs) {
  var value = Cog_normalizeDecision(input);
  var errors = Cog_validateCommon_(value, nowMs, 'createdAt');
  if (!Cog_validId_(value.hypothesisId)) errors.push('DECISION_HYPOTHESIS_ID_INVALID');
  if (!Object.prototype.hasOwnProperty.call(COG_DECISION_STATE, value.state)) errors.push('DECISION_STATE_INVALID');
  if (!Cog_inRange_(value.rationale.length, 1, 4000)) errors.push('DECISION_RATIONALE_INVALID');

  // Exactly one state-specific payload is required.  The missing payload is a
  // rejection, never an implicit fallback to ACT or an empty action.
  if (value.state === COG_DECISION_STATE.ACT && !Cog_validAction_(value.action)) errors.push('DECISION_ACT_ACTION_INVALID');
  if (value.state === COG_DECISION_STATE.ASK && !Cog_inRange_(value.question.length, 1, 2000)) errors.push('DECISION_ASK_QUESTION_INVALID');
  if (value.state === COG_DECISION_STATE.DEFER && !Cog_validFutureIso_(value.reviewAt, nowMs)) errors.push('DECISION_DEFER_REVIEW_INVALID');
  if (value.state === COG_DECISION_STATE.ESCALATE && !Cog_validEscalation_(value.escalation)) errors.push('DECISION_ESCALATION_INVALID');
  return Cog_validation_(value, errors);
}

/** @return {Cog_Validation} */
function Cog_validateOutcome(input, nowMs) {
  var value = Cog_normalizeOutcome(input);
  var errors = Cog_validateCommon_(value, nowMs, 'observedAt');
  if (!Cog_validId_(value.decisionId)) errors.push('OUTCOME_DECISION_ID_INVALID');
  if (!Object.prototype.hasOwnProperty.call(COG_OUTCOME_STATUS, value.status)) errors.push('OUTCOME_STATUS_INVALID');
  if (!Cog_inRange_(value.summary.length, 1, 4000)) errors.push('OUTCOME_SUMMARY_INVALID');
  return Cog_validation_(value, errors);
}

function Cog_validateCommon_(value, nowMs, occurredField) {
  var errors = [];
  if (!Cog_validId_(value.id)) errors.push('RECORD_ID_INVALID');
  if (!Cog_validId_(value.idempotencyKey)) errors.push('IDEMPOTENCY_KEY_INVALID');
  if (!Cog_validEvidenceIds_(value.evidenceIds)) errors.push('EVIDENCE_IDS_INVALID');
  if (typeof value.confidence !== 'number' || !isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) errors.push('CONFIDENCE_INVALID');
  var occurredMs = Cog_parseIsoMs_(value[occurredField]);
  var expiryMs = Cog_parseIsoMs_(value.expiresAt);
  if (occurredMs === null) errors.push('OCCURRED_AT_INVALID');
  if (expiryMs === null || (occurredMs !== null && expiryMs <= occurredMs)) errors.push('EXPIRY_INVALID');
  if (typeof nowMs === 'number' && isFinite(nowMs) && expiryMs !== null && expiryMs <= nowMs) errors.push('RECORD_EXPIRED');
  return errors;
}

function Cog_validation_(value, errors) {
  return Object.freeze({ ok: errors.length === 0, value: Object.freeze(value), errors: Object.freeze(errors.slice()) });
}

function Cog_normalizeRecord_(input, fields) {
  var source = Cog_plainObject_(input) ? input : {};
  var value = { evidenceIds: Cog_normalizeEvidenceIds_(source.evidenceIds), confidence: source.confidence };
  fields.forEach(function (field) { value[field] = Cog_text_(source[field]); });
  return value;
}

function Cog_normalizeEvidenceIds_(ids) {
  if (!Array.isArray(ids)) return [];
  var seen = {};
  return ids.map(Cog_text_).filter(function (id) {
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function Cog_validEvidenceIds_(ids) { return Array.isArray(ids) && ids.length > 0 && ids.length <= 64 && ids.every(Cog_validId_); }
function Cog_validId_(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/.test(value); }
function Cog_inRange_(length, min, max) { return typeof length === 'number' && length >= min && length <= max; }
function Cog_text_(value) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; }
function Cog_plainObject_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function Cog_clone_(value) { return JSON.parse(JSON.stringify(value)); }
function Cog_parseIsoMs_(value) { var ms = typeof value === 'string' ? Date.parse(value) : NaN; return isFinite(ms) ? ms : null; }
function Cog_validFutureIso_(value, nowMs) { var ms = Cog_parseIsoMs_(value); return ms !== null && (typeof nowMs !== 'number' || ms > nowMs); }
function Cog_validAction_(value) { return Cog_plainObject_(value) && Cog_validId_(Cog_text_(value.type)) && Cog_validId_(Cog_text_(value.idempotencyKey)); }
function Cog_validEscalation_(value) { return Cog_plainObject_(value) && Cog_validId_(Cog_text_(value.target)) && Cog_inRange_(Cog_text_(value.reason).length, 1, 2000); }

/**
 * Creates an immutable correlation context.  Callers supply eventId and
 * idempotencyKey from the ingress record; this function never derives them
 * from sensitive payload content.
 */
function Core_createRequestContext(input) {
  input = input || {};
  const startedAtMs = Number(input.startedAtMs || Date.now());
  const budgetMs = Math.max(1, Number(input.budgetMs || BIOOS_CONFIG.TIMING.WATCHDOG_MAX_EXECUTION_MS));
  const requestId = Core_createId_('req');
  const eventId = String(input.eventId || requestId);
  const idempotencyKey = String(input.idempotencyKey || eventId);
  const correlation = Object.freeze(Core_copyStringMap_(input.correlation));
  return Object.freeze({
    requestId: requestId,
    eventId: eventId,
    idempotencyKey: idempotencyKey,
    operation: String(input.operation || CORE_OPERATION.WEBHOOK),
    startedAtMs: startedAtMs,
    deadlineMs: startedAtMs + budgetMs,
    source: String(input.source || 'unknown'),
    correlation: correlation
  });
}

/** Returns remaining execution budget, clamped to zero. */
function Core_remainingBudgetMs(context, nowMs) {
  if (!context || !isFinite(context.deadlineMs)) return 0;
  return Math.max(0, Number(context.deadlineMs) - Number(nowMs || Date.now()));
}

/** Emits context-safe telemetry without making telemetry a hard dependency. */
function Core_telemetryFields(context, extra) {
  const fields = Core_copyStringMap_(extra);
  if (context) {
    fields.requestId = context.requestId;
    fields.eventId = context.eventId;
    fields.idempotencyKey = context.idempotencyKey;
    fields.operation = context.operation;
  }
  return fields;
}

function Core_createId_(prefix) {
  const uuid = (typeof Utilities !== 'undefined' && Utilities.getUuid) ? Utilities.getUuid() : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  return String(prefix || 'id') + '-' + uuid;
}

function Core_copyStringMap_(source) {
  const target = {};
  if (!source || Object.prototype.toString.call(source) !== '[object Object]') return target;
  Object.keys(source).forEach(function(key) {
    target[String(key)] = String(source[key]);
  });
  return target;
}

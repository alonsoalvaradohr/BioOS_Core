/** Returns a successful, immutable result envelope. */
function Core_ok(value, meta) {
  return Object.freeze({
    ok: true,
    value: value,
    meta: Object.freeze(meta || {})
  });
}

/** Returns a failed, immutable result envelope. */
function Core_err(error, meta) {
  const normalized = Core_normalizeError(error);
  return Object.freeze({
    ok: false,
    error: Object.freeze(normalized),
    meta: Object.freeze(meta || {})
  });
}

/**
 * Executes a synchronous operation without letting an unclassified exception
 * cross a service boundary.
 */
function Core_try(operation, context, fn) {
  try {
    return Core_ok(fn(), {
      operation: operation,
      requestId: context && context.requestId ? context.requestId : ''
    });
  } catch (error) {
    return Core_err(error, {
      operation: operation,
      requestId: context && context.requestId ? context.requestId : ''
    });
  }
}

/** Maps a successful result without unwrapping an error result. */
function Core_map(result, mapper) {
  if (!result || !result.ok) return result || Core_err(Core_error('CORE_INVALID_RESULT', 'CORE', 'Resultado ausente.', false));
  try {
    return Core_ok(mapper(result.value), result.meta);
  } catch (error) {
    return Core_err(error, result.meta);
  }
}

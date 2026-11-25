// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Alonso Alvarado Hernández <alonsoalvaradohr>
/** Creates a classified error record; it never includes secret values. */
function Core_error(code, category, message, retryable, details, causeName) {
  return {
    code: String(code || 'CORE_UNKNOWN'),
    category: String(category || 'CORE'),
    message: String(message || 'Error no clasificado.'),
    retryable: retryable === true,
    details: details || {},
    causeName: String(causeName || '')
  };
}

/** Converts native and legacy errors to the stable Core_ErrorInfo shape. */
function Core_normalizeError(error) {
  if (error && error.code && error.category && error.message) {
    return Core_error(error.code, error.category, error.message, error.retryable, error.details, error.causeName);
  }

  const message = error && error.message ? String(error.message) : String(error || 'Error desconocido.');
  const name = error && error.name ? String(error.name) : '';
  if (/\b(429|503|timeout|timed out|temporar)/i.test(message)) {
    return Core_error('CORE_TRANSIENT_DEPENDENCY', 'DEPENDENCY', message, true, {}, name);
  }
  if (/\b(parse|json|schema|format)/i.test(message)) {
    return Core_error('CORE_INVALID_PAYLOAD', 'VALIDATION', message, false, {}, name);
  }
  if (/\b(unauthori[sz]ed|forbidden|permission|auth)/i.test(message)) {
    return Core_error('CORE_AUTHORIZATION', 'SECURITY', message, false, {}, name);
  }
  if (/\b(lock|deadlock|contention)/i.test(message)) {
    return Core_error('CORE_CONCURRENCY', 'CONCURRENCY', message, true, {}, name);
  }
  return Core_error('CORE_UNEXPECTED', 'CORE', message, false, {}, name);
}

/** True only for failures that can safely be retried with the same key. */
function Core_isRetryable(result) {
  return Boolean(result && result.ok === false && result.error && result.error.retryable === true);
}

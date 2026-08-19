/**
 * Parses an LLM/API structured JSON response into Core_Result. It accepts one
 * object or array embedded in surrounding prose, but never silently returns an
 * empty object on malformed input.
 */
function Core_parseStructuredJson(input, options) {
  options = options || {};
  if (input === null || input === undefined || String(input).trim() === '') {
    return Core_err(Core_error('CORE_JSON_EMPTY', 'VALIDATION', 'Respuesta estructurada vacía.', false));
  }
  const text = String(input).trim();
  const maxChars = Number(options.maxChars || 50000);
  if (text.length > maxChars) {
    return Core_err(Core_error('CORE_JSON_TOO_LARGE', 'VALIDATION', 'Respuesta estructurada supera el límite permitido.', false, { maxChars: maxChars, receivedChars: text.length }));
  }

  const extracted = Core_extractJsonCandidate_(text, options.allowMarkdownFence !== false);
  if (!extracted.ok) return extracted;
  let value;
  try {
    value = JSON.parse(extracted.value);
  } catch (error) {
    return Core_err(Core_error('CORE_JSON_PARSE', 'VALIDATION', 'JSON estructurado inválido.', false, { candidateChars: extracted.value.length }, error.name));
  }
  if (options.expectedType && Core_jsonType_(value) !== options.expectedType) {
    return Core_err(Core_error('CORE_JSON_TYPE', 'VALIDATION', 'Tipo JSON inesperado.', false, { expectedType: options.expectedType, actualType: Core_jsonType_(value) }));
  }
  if (options.validator) {
    try {
      const validation = options.validator(value);
      if (validation === false) return Core_err(Core_error('CORE_JSON_SCHEMA', 'VALIDATION', 'El JSON no cumple el contrato.', false));
      if (validation && validation.ok === false) return validation;
    } catch (error) {
      return Core_err(Core_error('CORE_JSON_SCHEMA', 'VALIDATION', 'El validador del contrato falló.', false, {}, error.name));
    }
  }
  return Core_ok(value, { candidateChars: extracted.value.length, type: Core_jsonType_(value) });
}

function Core_extractJsonCandidate_(text, allowMarkdownFence) {
  const source = allowMarkdownFence ? text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim() : text;
  const start = source.search(/[\[{]/);
  if (start < 0) return Core_err(Core_error('CORE_JSON_MISSING', 'VALIDATION', 'No se encontró objeto ni arreglo JSON.', false));
  const opening = source.charAt(start);
  const closing = opening === '{' ? '}' : ']';
  const pairs = { '{': '}', '[': ']' };
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (pairs[character]) {
      stack.push(pairs[character]);
      continue;
    }
    if (character === '}' || character === ']') {
      if (stack.length === 0 || stack[stack.length - 1] !== character) {
        return Core_err(Core_error('CORE_JSON_UNBALANCED', 'VALIDATION', 'JSON estructurado tiene delimitadores incompatibles.', false));
      }
      stack.pop();
      if (stack.length === 0) return Core_ok(source.substring(start, index + 1));
    }
  }
  return Core_err(Core_error('CORE_JSON_UNBALANCED', 'VALIDATION', 'JSON estructurado incompleto o desbalanceado.', false));
}

function Core_jsonType_(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * ==============================================================================
 * ARCHIVO: 01_Sys_Telemetry.gs
 * SISTEMA: BioOS v5 (Arquitectura SRE)
 * DESCRIPCIÓN: Motor de resiliencia, trazabilidad correlacionada y watchdog.
 * HITO 0.6 (Fase 1): Conexión al Repositorio de Datos Central (DB_Repository).
 * Erradicación de la lógica I/O duplicada.
 * ==============================================================================
 */

// Reloj maestro para prevenir la inanición de hilos en Google Apps Script
const _GLOBAL_EXEC_START = Date.now();
const _CRITICAL_TIME_LIMIT = 260000; // 4.3 minutos

let _telemetryBuffer = [];
let _executionDepth = 0;
let _telemetryFlushInProgress = false;

const _TELEMETRY_SCHEMA_VERSION = '2.0';

/**
 * Sanitiza texto para compatibilidad estricta con Telegram Bot API (HTML parse_mode).
 * 
 * Reglas Telegram Bot API HTML:
 * 1. Tags permitidos: <b>, <strong>, <i>, <em>, <u>, <ins>, <s>, <strike>, <del>,
 *    <tg-spoiler>, <span class="tg-spoiler">, <a href="...">, <code>, <pre>,
 *    <pre><code class="language-...">, <blockquote>, <blockquote expandable>, <tg-emoji id="...">.
 * 2. Todos los caracteres '<', '>', '&' en texto literal que no formen
 *    parte de un tag válido se escapan como &lt;, &gt;, &amp;.
 * 3. Todos los tags abiertos se balancean y cierran automáticamente en orden estricto.
 * 4. Si el texto supera maxLength, se trunca de forma segura y se cierran los tags abiertos.
 */
function _sanitizeTelegramHtml_(rawText, maxLength) {
  if (rawText === undefined || rawText === null || rawText === '') return '';
  var text = String(rawText);
  var maxLen = (typeof maxLength === 'number' && maxLength > 0) ? maxLength : 4000;

  // 1. Normalizar saltos de línea y etiquetas de bloque comunes no soportadas por Telegram
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<(p|div|tr|h[1-6])(?:\s+[^>]*)?>/gi, '\n')
    .replace(/<\/?(table|thead|tbody)[^>]*>/gi, '\n')
    .replace(/<\/?(td|th)[^>]*>/gi, ' ')
    .replace(/<\/?li[^>]*>/gi, '\n• ')
    .replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
    .replace(/<\/?hr\s*\/?>/gi, '\n---\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) return '';

  // 2. Tokenizador: divide en (a) tags HTML potenciales, (b) entidades HTML válidas ya existentes, (c) texto literal
  var tokenRegex = /(<(?:\/?[a-zA-Z0-9_-]+(?:\s+[^<>]*)?|\!--[\s\S]*?--)\s*>|&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;

  var tokens = [];
  var lastIndex = 0;
  var match;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.substring(lastIndex, match.index) });
    }
    if (match[0].startsWith('&')) {
      tokens.push({ type: 'entity', value: match[0] });
    } else {
      tokens.push({ type: 'tag', value: match[0] });
    }
    lastIndex = tokenRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.substring(lastIndex) });
  }

  // 3. Parser, Validador de Tags y Árbol de Anidación (Tag Balancer)
  var openStack = [];
  var out = '';
  var truncated = false;

  function appendLiteral(str) {
    if (!str || truncated) return;
    var escaped = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (out.length + escaped.length > maxLen - 20) {
      var available = Math.max(0, maxLen - 20 - out.length);
      out += escaped.substring(0, available);
      truncated = true;
    } else {
      out += escaped;
    }
  }

  function appendRaw(str) {
    if (!str || truncated) return;
    if (out.length + str.length > maxLen - 20) {
      var available = Math.max(0, maxLen - 20 - out.length);
      out += str.substring(0, available);
      truncated = true;
    } else {
      out += str;
    }
  }

  for (var i = 0; i < tokens.length; i++) {
    if (truncated) break;
    var t = tokens[i];

    if (t.type === 'text') {
      appendLiteral(t.value);
    } else if (t.type === 'entity') {
      appendRaw(t.value);
    } else if (t.type === 'tag') {
      var tagStr = t.value;
      var parsed = tagStr.match(/^<\s*(\/)?\s*([a-zA-Z0-9_-]+)([\s\S]*?)>$/);
      if (!parsed) {
        appendLiteral(tagStr);
        continue;
      }

      var isClosing = !!parsed[1];
      var rawName = parsed[2].toLowerCase();
      var attrs = (parsed[3] || '').trim();

      var canonicalTag = rawName;
      if (rawName === 'strong') canonicalTag = 'b';
      else if (rawName === 'em') canonicalTag = 'i';
      else if (rawName === 'ins') canonicalTag = 'u';
      else if (rawName === 'strike' || rawName === 'del') canonicalTag = 's';

      var isAllowed = (
        canonicalTag === 'b' ||
        canonicalTag === 'i' ||
        canonicalTag === 'u' ||
        canonicalTag === 's' ||
        canonicalTag === 'code' ||
        canonicalTag === 'pre' ||
        canonicalTag === 'tg-spoiler' ||
        canonicalTag === 'span' ||
        canonicalTag === 'a' ||
        canonicalTag === 'blockquote' ||
        canonicalTag === 'tg-emoji'
      );

      if (!isAllowed) {
        appendLiteral(tagStr);
        continue;
      }

      if (isClosing) {
        var matchIdx = -1;
        for (var s = openStack.length - 1; s >= 0; s--) {
          if (openStack[s].name === canonicalTag || (canonicalTag === 'span' && openStack[s].name === 'span')) {
            matchIdx = s;
            break;
          }
        }

        if (matchIdx !== -1) {
          while (openStack.length > matchIdx) {
            var closedTag = openStack.pop();
            appendRaw(closedTag.closeTag);
          }
        }
      } else {
        if (canonicalTag === 'a') {
          var hrefMatch = attrs.match(/href\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
          var rawHref = hrefMatch ? (hrefMatch[1] || hrefMatch[2]) : '';
          if (rawHref) {
            var cleanHref = rawHref
              .replace(/&amp;/g, '&')
              .replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/</g, '%3C')
              .replace(/>/g, '%3E');
            appendRaw('<a href="' + cleanHref + '">');
            openStack.push({ name: 'a', closeTag: '</a>' });
          } else {
            appendLiteral(tagStr);
          }
        } else if (canonicalTag === 'span') {
          if (/\bclass\s*=\s*["']?tg-spoiler["']?/i.test(attrs)) {
            appendRaw('<span class="tg-spoiler">');
            openStack.push({ name: 'span', closeTag: '</span>' });
          } else {
            appendLiteral(tagStr);
          }
        } else if (canonicalTag === 'tg-emoji') {
          var idMatch = attrs.match(/id\s*=\s*["']?(\d+)["']?/i);
          if (idMatch && idMatch[1]) {
            appendRaw('<tg-emoji id="' + idMatch[1] + '">');
            openStack.push({ name: 'tg-emoji', closeTag: '</tg-emoji>' });
          } else {
            appendLiteral(tagStr);
          }
        } else if (canonicalTag === 'code') {
          var langMatch = attrs.match(/class\s*=\s*["']?language-([a-zA-Z0-9_-]+)["']?/i);
          if (langMatch && langMatch[1]) {
            appendRaw('<code class="language-' + langMatch[1] + '">');
          } else {
            appendRaw('<code>');
          }
          openStack.push({ name: 'code', closeTag: '</code>' });
        } else if (canonicalTag === 'pre') {
          var preLangMatch = attrs.match(/class\s*=\s*["']?language-([a-zA-Z0-9_-]+)["']?/i);
          if (preLangMatch && preLangMatch[1]) {
            appendRaw('<pre><code class="language-' + preLangMatch[1] + '">');
            openStack.push({ name: 'pre', closeTag: '</code></pre>' });
          } else {
            appendRaw('<pre>');
            openStack.push({ name: 'pre', closeTag: '</pre>' });
          }
        } else if (canonicalTag === 'blockquote') {
          if (/\bexpandable\b/i.test(attrs)) {
            appendRaw('<blockquote expandable>');
          } else {
            appendRaw('<blockquote>');
          }
          openStack.push({ name: 'blockquote', closeTag: '</blockquote>' });
        } else {
          appendRaw('<' + canonicalTag + '>');
          openStack.push({ name: canonicalTag, closeTag: '</' + canonicalTag + '>' });
        }
      }
    }
  }

  if (truncated) {
    out = out.trim() + '\n\n[...]';
  }

  while (openStack.length > 0) {
    var remainingTag = openStack.pop();
    out += remainingTag.closeTag;
  }

  return out;
}

/**
 * Canal de salida exclusivo para la síntesis humana final (Silenciamiento SRE).
 * Incluye sanitización HTML, reintentos con backoff exponencial, fallback a texto plano y telemetría de códigos HTTP.
 * Nunca debe ser llamado por sendSystemTelemetry.
 */
function _rawSystemNotify(text, targetChatId) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("TELEGRAM_BOT_TOKEN");
    const chatId = (targetChatId === undefined || targetChatId === null || targetChatId === '')
      ? props.getProperty("TELEGRAM_CHAT_ID") : String(targetChatId);

    if (!token || !chatId) {
      console.error("[SYS_PANIC] Credenciales de Telegram ausentes en PropertiesService (TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID).");
      return false;
    }

    let sanitizedText = _sanitizeTelegramHtml_(text, 4000);

    if (!sanitizedText) {
      console.warn("[TELEGRAM_WARN] Intento de enviar mensaje vacío a Telegram.");
      return false;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const maxRetries = 3;
    let delayMs = 1000;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const payload = {
          chat_id: chatId,
          text: sanitizedText,
          parse_mode: "HTML"
        };

        const response = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const code = response.getResponseCode();
        const contentText = response.getContentText();

        if (code >= 200 && code < 300) {
          return true;
        }

        // Si Telegram rechaza por parseo de HTML (HTTP 400), fallback inmediato a texto plano sin tags
        if (code === 400 && (contentText.includes("can't parse entities") || contentText.includes("entity") || contentText.includes("tag") || contentText.includes("bad request"))) {
          console.warn(`[TELEGRAM_HTML_RETRY] Fallo de parseo HTML (HTTP 400). Reintentando en texto plano sin formato...`);
          const plainText = String(text || '').replace(/<[^>]+>/g, '').trim();
          const fallbackResponse = UrlFetchApp.fetch(url, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify({ chat_id: chatId, text: plainText.substring(0, 4000) }),
            muteHttpExceptions: true
          });

          const fallbackCode = fallbackResponse.getResponseCode();
          if (fallbackCode >= 200 && fallbackCode < 300) {
            console.log("[TELEGRAM_SUCCESS] Mensaje entregado exitosamente mediante fallback de texto plano.");
            return true;
          } else {
            console.error(`[TELEGRAM_FALLBACK_ERR] Fallback texto plano falló con HTTP ${fallbackCode}: ${fallbackResponse.getContentText()}`);
          }
        }

        lastError = new Error(`HTTP ${code}: ${contentText}`);

        // Reintentar en casos de Rate Limit (429) o errores de servidor (5xx)
        if (code === 429 || code >= 500) {
          console.warn(`[TELEGRAM_RETRY] Intento ${attempt}/${maxRetries} falló con HTTP ${code}. Esperando ${delayMs}ms...`);
          Utilities.sleep(delayMs);
          delayMs *= 2;
          continue;
        }

        console.error(`[TELEGRAM_FAULT] Error no recuperable de Telegram (HTTP ${code}): ${contentText}`);
        break;

      } catch (netError) {
        lastError = netError;
        console.warn(`[TELEGRAM_NET_WARN] Error de red en intento ${attempt}/${maxRetries}: ${netError.message}`);
        if (attempt < maxRetries) {
          Utilities.sleep(delayMs);
          delayMs *= 2;
        }
      }
    }

    console.error(`[TELEMETRY_FAULT] Falla crítica definitiva en canal de notificaciones Telegram: ${lastError ? lastError.message : 'Error desconocido'}`);
    return false;
  } catch (error) {
    console.error(`[TELEMETRY_FAULT] Falla inesperada en _rawSystemNotify: ${error.message}`);
    return false;
  }
}

/**
 * Emisor de telemetría SRE.
 * Acumula exclusivamente en RAM V8 (Cero llamadas de red/Telegram en runtime).
 */
function sendSystemTelemetry(state, message, fields) {
  const debugEnabled = typeof BIOOS_CONFIG === 'undefined' || !BIOOS_CONFIG.SYS_FLAGS || BIOOS_CONFIG.SYS_FLAGS.DEBUG_MODE !== false;
  if (!debugEnabled) return;

  const maxBuffer = (typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG.LOGGING && BIOOS_CONFIG.LOGGING.MAX_BUFFER_SIZE)
                    ? BIOOS_CONFIG.LOGGING.MAX_BUFFER_SIZE
                    : 200;

  // Protección contra desbordamiento de heap V8
  if (_telemetryBuffer.length >= maxBuffer) {
    _telemetryBuffer.shift();
  }

  const telemetryDict = (typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG.TELEMETRY) ? BIOOS_CONFIG.TELEMETRY : {};
  const prefix = telemetryDict[state] || "🧠 [SYS_INFO] -";
  const event = _buildTelemetryEvent_(state, message, fields);

  _telemetryBuffer.push([
    event.timestamp,
    prefix,
    _serializeTelemetryEvent_(event),
    event.elapsedMs + "ms"
  ]);
}

/**
 * Context-aware API for new code.  Legacy callers can keep using
 * sendSystemTelemetry(state, message) without losing compatibility.
 */
function sendContextualTelemetry(context, severity, message, fields) {
  const correlated = typeof Core_telemetryFields === 'function'
    ? Core_telemetryFields(context, fields)
    : _mergeTelemetryFields_(fields, context);
  return sendSystemTelemetry(severity, message, correlated);
}

function _buildTelemetryEvent_(severity, message, fields) {
  const safeFields = _sanitizeTelemetryFields_(fields);
  const elapsedMs = Math.max(0, Date.now() - _GLOBAL_EXEC_START);
  return {
    schemaVersion: _TELEMETRY_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    severity: String(severity || 'INFO').toUpperCase(),
    message: String(message || '').substring(0, 2500),
    requestId: safeFields.requestId || '',
    eventId: safeFields.eventId || '',
    operation: safeFields.operation || 'unknown',
    elapsedMs: elapsedMs,
    fields: safeFields
  };
}

function _serializeTelemetryEvent_(event) {
  // The current repository owns a four-column sheet.  Preserve that contract
  // while storing a queryable, versioned structured envelope in MESSAGE.
  return JSON.stringify(event).substring(0, 4000);
}

function _sanitizeTelemetryFields_(fields) {
  const result = {};
  if (!fields || Object.prototype.toString.call(fields) !== '[object Object]') return result;
  Object.keys(fields).slice(0, 24).forEach(function(key) {
    const value = fields[key];
    if (value === undefined || value === null) return;
    result[String(key).substring(0, 80)] = String(value).substring(0, 500);
  });
  return result;
}

function _mergeTelemetryFields_(fields, context) {
  const result = _sanitizeTelemetryFields_(fields);
  if (context && typeof context === 'object') {
    ['requestId', 'eventId', 'idempotencyKey', 'operation'].forEach(function(key) {
      if (context[key]) result[key] = String(context[key]);
    });
  }
  return result;
}

/**
 * Volcado atómico (Single-Batch Flush) del búfer a L1_Telemetry_Log.
 * AHORA DELEGA LA ESCRITURA AL REPOSITORIO DE DATOS (02b).
 */
function flushSRETelemetryToVFS() {
  if (_telemetryBuffer.length === 0 || _telemetryFlushInProgress) return { flushed: 0, pending: _telemetryBuffer.length };
  // Do not take ScriptLock here: repoFlushTelemetryBatch is its sole owner.
  // Retain the batch until the repository confirms its write.
  const batch = _telemetryBuffer.slice();
  _telemetryFlushInProgress = true;

  try {
    if (typeof repoFlushTelemetryBatch !== "function") {
      throw new Error('DB_Repository dependency unavailable; batch retained for retry.');
    }
    repoFlushTelemetryBatch(batch);
    // Only remove the exact snapshot. Events emitted during I/O stay buffered.
    _telemetryBuffer.splice(0, batch.length);
    return { flushed: batch.length, pending: _telemetryBuffer.length };
  } catch (e) {
    console.error(`[SRE_LOG_FAULT] VFS flush failed; ${batch.length} events retained: ${e.message}`);
    return { flushed: 0, pending: _telemetryBuffer.length, retryable: true, error: String(e.message) };
  } finally {
    _telemetryFlushInProgress = false;
  }
}

/**
 * ==============================================================================
 * SISTEMA DE PROVENANCIA Y LINAJE (Data Lineage)
 * ==============================================================================
 */
function recordProvenance(dataPayload, sourceId, isInferred = false) {
  return {
    ...dataPayload,
    _provenance: {
      timestamp: new Date().toISOString(),
      source: sourceId,
      is_inferred: isInferred,
      schema_version: "5.0"
    }
  };
}

/**
 * ==============================================================================
 * MOTOR DE RESILIENCIA Y ENRUTAMIENTO SRE (Kernel Wrapper)
 * ==============================================================================
 */
function executeWithResilience(taskName, taskFunction, maxRetries = (typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG && BIOOS_CONFIG.RESILIENCE ? BIOOS_CONFIG.RESILIENCE.MAX_RETRIES : 3)) {
  _executionDepth++;
  let attempt = 0;
  let delayMs = (typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG && BIOOS_CONFIG.RESILIENCE ? BIOOS_CONFIG.RESILIENCE.BACKOFF_BASE_MS : 2000);

  try {
    while (attempt < maxRetries) {
      try {
        // Watchdog preventivo contra Hard-Kill de GAS (6 minutos)
        if (Date.now() - _GLOBAL_EXEC_START > _CRITICAL_TIME_LIMIT) {
          sendSystemTelemetry("FATAL", `[WATCHDOG] Límite de tiempo crítico alcanzado en ${taskName}. Cortando circuito.`);
          throw new Error(`[SRE_ABORT] Watchdog Global: Inanición de tiempo agotada.`);
        }

        sendSystemTelemetry("PROCESS", `[EXEC] ${taskName} | Intento: ${attempt + 1}/${maxRetries}`);
        return taskFunction();

      } catch (error) {
        if (error.message.includes("[SRE_ABORT]")) {
          throw error;
        }

        attempt++;
        sendSystemTelemetry("ERROR", `[FAULT] ${taskName}: ${error.message}`);

        const isInfraDown = error.message.includes("HTTP 503") || error.message.includes("HTTP 429");
        if (isInfraDown && (Date.now() - _GLOBAL_EXEC_START > 150000)) {
           sendSystemTelemetry("ERROR", `[CIRCUIT_BREAKER] API saturada bajo presión de tiempo. Abortando ${taskName}.`);
           throw new Error(`[SRE_ABORT] Fallo de infraestructura (503/429) bajo presión de tiempo.`);
        }

        if (attempt >= maxRetries) {
          sendSystemTelemetry("FATAL", `Colapso definitivo en: ${taskName}. Excepción: ${error.message}`);

          const isInternalTask = taskName.startsWith("Mem_") || taskName.startsWith("SRE_") || taskName.startsWith("Install_") || taskName.startsWith("Reconcile_") || taskName.startsWith("Orchestrator_");
          const autoRepair = (typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG && BIOOS_CONFIG.SYS_FLAGS && BIOOS_CONFIG.SYS_FLAGS.ENABLE_AUTO_REPAIR);
          if (autoRepair && !isInfraDown && _executionDepth <= 1 && !isInternalTask) {
             sendSystemTelemetry("SRE", `Despertando Agente SRE para evaluar: ${taskName}`);
             try {
               if (typeof analyzeAndPatchRootCause === "function") {
                 analyzeAndPatchRootCause(taskName, error.message, error.stack);
               }
             } catch (sreError) {
               console.error(`[SRE_FAULT] Fallo SRE: ${sreError.message}`);
             }
          }
          throw new Error(`[SRE_ABORT] Proceso ${taskName} abortado tras ${maxRetries} intentos.`);
        }

        Utilities.sleep(delayMs);
        delayMs *= 2;
      }
    }
  } finally {
    _executionDepth--;
    // Únicamente el hilo raíz ejecuta el volcado atómico para evitar flushes anidados
    if (_executionDepth === 0) {
      flushSRETelemetryToVFS();
    }
  }
}

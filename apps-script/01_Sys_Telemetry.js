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
 * Canal de salida exclusivo para la síntesis humana final (Silenciamiento SRE).
 * Nunca debe ser llamado por sendSystemTelemetry.
 */
function _rawSystemNotify(text, targetChatId) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("TELEGRAM_BOT_TOKEN");
    const chatId = targetChatId === undefined || targetChatId === null || targetChatId === ''
      ? props.getProperty("TELEGRAM_CHAT_ID") : String(targetChatId);

    if (!token || !chatId) {
      console.error("[SYS_PANIC] Credenciales de Telegram ausentes en PropertiesService.");
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" }),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error('[TELEGRAM_SEND_FAILED] HTTP ' + response.getResponseCode());
    }
    return true;
  } catch (error) {
    console.error(`[TELEMETRY_FAULT] Falla crítica en canal de notificaciones: ${error.message}`);
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
function executeWithResilience(taskName, taskFunction, maxRetries = BIOOS_CONFIG.RESILIENCE.MAX_RETRIES) {
  _executionDepth++;
  let attempt = 0;
  let delayMs = BIOOS_CONFIG.RESILIENCE.BACKOFF_BASE_MS;

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

          if (BIOOS_CONFIG.SYS_FLAGS.ENABLE_AUTO_REPAIR && !isInfraDown) {
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

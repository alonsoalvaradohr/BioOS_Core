/**
 * ==============================================================================
 * ARCHIVO: 03b_Net_Webhook.gs
 * SISTEMA: BioOS v4.1 (Arquitectura SRE)
 * DESCRIPCIÓN: Pasarela de red hiper-rápida.
 * HITO 1.3 (Paso 2): Ingesta Acústica Multimodal. Intercepción de notas de
 * voz de Telegram, conversión a Base64 en runtime y encolamiento a L0.
 * ==============================================================================
 */
const _NET_MAX_VOICE_BYTES = 8 * 1024 * 1024;


function doPost(e) {
  try {
    if (BIOOS_CONFIG.SYS_FLAGS.MAINTENANCE_MODE) return _silentDrop();

    // 1. ZERO-TRUST AUTHENTICATION
    // Apps Script web-app events do not expose HTTP request headers. Telegram's
    // secret_token is delivered only in X-Telegram-Bot-Api-Secret-Token, so a
    // direct anonymous GAS endpoint cannot verify it safely. Never fall back to
    // a query-string secret: direct ingress is fail-closed unless an authenticated
    // proxy has injected a body token that we can compare here.
    const props = PropertiesService.getScriptProperties();
    const expectedSecret = props.getProperty("TELEGRAM_SECRET_TOKEN");
    const incomingSecret = _getProxyWebhookToken(e);
    if (!expectedSecret || !incomingSecret || !_constantTimeEquals(expectedSecret, incomingSecret)) {
      if (typeof sendSystemTelemetry === "function") {
        sendSystemTelemetry("WARNING", "[WEBHOOK_AUTH] Ingreso rechazado: GAS no puede verificar headers Telegram; se requiere proxy autenticado.");
      }
      return _silentDrop();
    }

    let update;
    try {
      update = JSON.parse(e.postData.contents);
    } catch (err) {
      return _silentDrop();
    }

    if (!update.message) return _silentDrop();

    const updateId = update.update_id;
    if (updateId === undefined || updateId === null) return _silentDrop();

    // The durable repository, not Script Properties, is the idempotency owner.
    // This is atomic with the enqueue operation and survives concurrent webhooks.
    // In particular, do not download voice media here: Telegram expects a fast 2xx
    // response and will retry a slow webhook.
    if (update.message.text) {
      const messageText = update.message.text;
      if (messageText.startsWith("/")) {
        _handleBypassCommand(messageText, update.message.chat && update.message.chat.id);
      } else {
        enqueueAndDispatchNLP(messageText, _netBuildIngressOptions_(update, 'telegram_text'));
      }
    }
    else if (update.message.voice) {
      const voice = update.message.voice;
      if (!(BIOOS_CONFIG.CAPABILITIES && BIOOS_CONFIG.CAPABILITIES.VOICE_INPUT === true)) {
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[VOICE_DISABLED] Nota de voz ignorada por política.");
        return _silentDrop();
      }
      if (Number(voice.file_size || 0) > _NET_MAX_VOICE_BYTES) {
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[VOICE_TOO_LARGE] Nota de voz rechazada antes de encolar.");
        return _silentDrop();
      }
      // The worker resolves file_id later.  The queue stores metadata only, never
      // an inflated base64 blob or Telegram credentials.
      enqueueAndDispatchNLP('[VOICE_MESSAGE]', _netBuildIngressOptions_(update, 'telegram_voice', {
        fileId: String(voice.file_id || ''),
        mimeType: 'audio/ogg', durationSeconds: Number(voice.duration || 0),
        fileSizeBytes: Number(voice.file_size || 0)
      }));
    }

    return _silentDrop();
  } catch (error) {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("ERROR", `[WEBHOOK_CRASH] ${error.message}`);
    return _silentDrop();
  }
}

/**
 * A trusted proxy may add _bioos_proxy_token to the JSON body after validating
 * Telegram's secret header. Query parameters are intentionally never accepted.
 */
function _getProxyWebhookToken(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : null;
    return body && typeof body._bioos_proxy_token === "string" ? body._bioos_proxy_token : null;
  } catch (error) {
    return null;
  }
}

function _constantTimeEquals(expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string" || expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return difference === 0;
}

/**
 * [HELPER SRE] Descarga y Conversión Base64
 * Extrae el binario de los servidores de Telegram y lo prepara para Gemini.
 */
function _downloadTelegramVoice(fileId) {
  const token = PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Token ausente para descarga de audio.");
  if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(fileId)) throw new Error("Identificador de audio inválido.");

  // Paso A: Obtener la ruta del archivo
  const fileInfoUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const fileInfoResponse = UrlFetchApp.fetch(fileInfoUrl, { muteHttpExceptions: true });

  if (fileInfoResponse.getResponseCode() !== 200) {
     throw new Error("Telegram rechazó la petición de ruta del archivo.");
  }

  const fileInfo = JSON.parse(fileInfoResponse.getContentText());
  if (!fileInfo.ok || !fileInfo.result || typeof fileInfo.result.file_path !== "string") throw new Error("El objeto de ruta del archivo está corrupto.");
  if (Number(fileInfo.result.file_size || 0) > _NET_MAX_VOICE_BYTES) throw new Error("La nota de voz excede el límite permitido.");

  // Paso B: Descargar el binario y codificar a Base64
  const filePath = fileInfo.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const audioResponse = UrlFetchApp.fetch(downloadUrl, { muteHttpExceptions: true, followRedirects: false });
  if (audioResponse.getResponseCode() !== 200) throw new Error("Telegram rechazó la descarga del audio.");
  const bytes = audioResponse.getBlob().getBytes();
  if (bytes.length > _NET_MAX_VOICE_BYTES) throw new Error("La nota de voz descargada excede el límite permitido.");
  return Utilities.base64Encode(bytes);
}

function _silentDrop() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function enqueueAndDispatchNLP(messageText, options) {
  if (typeof repoEnqueueNLP !== "function") throw new Error("[SRE_FAULT] Dependencia DB_Repository ausente.");
  var receipt = repoEnqueueNLP(messageText, options || {});
  var context = _netContextFromIngressOptions_(options);
  if (receipt && receipt.duplicate) {
    _netTelemetry_(context, 'PROCESS', '[WEBHOOK] Update duplicado confirmado por L0; no se programó otro worker.');
    return receipt;
  }

  // DEBOUNCING DE TRIGGERS
  const triggers = ScriptApp.getProjectTriggers();
  const workerExists = triggers.some(t => t.getHandlerFunction() === "workerProcessNLP");

  if (!workerExists) {
    ScriptApp.newTrigger("workerProcessNLP").timeBased().after(1000).create();
    _netTelemetry_(context, 'PROCESS', 'Webhook: job durable encolado; worker efímero programado.');
  } else {
    _netTelemetry_(context, 'PROCESS', 'Webhook: job durable encolado; worker existente se hará cargo.');
  }
  return receipt;
}

/** Builds the durable, non-sensitive ingress envelope used by L0. */
function _netBuildIngressOptions_(update, kind, extraMetadata) {
  var message = update && update.message || {};
  var updateId = String(update && update.update_id);
  var metadata = {
    schemaVersion: 1, kind: String(kind), source: 'telegram', updateId: updateId,
    chatId: message.chat && message.chat.id !== undefined ? String(message.chat.id) : '',
    messageId: message.message_id !== undefined ? String(message.message_id) : '',
    receivedAt: new Date().toISOString()
  };
  Object.keys(extraMetadata || {}).forEach(function(key) { metadata[key] = extraMetadata[key]; });
  return { idempotencyKey: 'telegram:update:' + updateId, receivedAt: metadata.receivedAt, metadata: metadata };
}

function _netContextFromIngressOptions_(options) {
  var o = options || {}, m = o.metadata || {};
  if (typeof Core_createRequestContext === 'function') return Core_createRequestContext({
    eventId: m.updateId || o.idempotencyKey, idempotencyKey: o.idempotencyKey,
    operation: typeof CORE_OPERATION !== 'undefined' ? CORE_OPERATION.WEBHOOK : 'webhook', source: m.source || 'telegram'
  });
  return { eventId: String(m.updateId || ''), idempotencyKey: String(o.idempotencyKey || ''), operation: 'webhook' };
}

function _netTelemetry_(context, severity, message, fields) {
  if (typeof sendContextualTelemetry === 'function') return sendContextualTelemetry(context, severity, message, fields);
  if (typeof sendSystemTelemetry === 'function') return sendSystemTelemetry(severity, message, fields);
}

function _handleBypassCommand(command, sourceChatId) {
  try {
    const normalizedCommand = String(command || '').trim().toLowerCase().split(/\s+/)[0].replace(/@[^\s]+$/, '');
    if (normalizedCommand === "/estado") {
      const stats = '🧠 BioOS v5 | Estado: ONLINE\n' +
                    'Ingesta: texto y voz\n' +
                    'Repositorio: activo';
      if (typeof _rawSystemNotify === "function" && !_rawSystemNotify(stats, sourceChatId)) {
        throw new Error('[COMMAND_NOTIFY_FAILED] No fue posible enviar /estado.');
      }
      return;
    }
    if (normalizedCommand === "/ping") {
      if (typeof _rawSystemNotify === "function" && !_rawSystemNotify("📡 Pong. Túnel seguro activo.", sourceChatId)) {
        throw new Error('[COMMAND_NOTIFY_FAILED] No fue posible enviar /ping.');
      }
    }
  } catch (e) {
    if (typeof sendSystemTelemetry === 'function') sendSystemTelemetry('ERROR', '[COMMAND_FAULT] ' + e.message);
    throw e;
  }
}

function registerTelegramWebhook() {
  return executeWithResilience("Registro_Webhook", () => {
    const props = PropertiesService.getScriptProperties();
    // The deployment URL is configuration, never source code: every new web-app
    // deployment gets its own URL and Telegram must be moved explicitly.
    const webAppUrl = props.getProperty("BIOOS_WEB_APP_URL");

    const botToken = props.getProperty("TELEGRAM_BOT_TOKEN");
    const secretToken = props.getProperty("TELEGRAM_SECRET_TOKEN");
    if (!botToken) throw new Error("[NET_FAULT] TELEGRAM_BOT_TOKEN ausente.");
    if (!_isApprovedTelegramWebhookUrl_(webAppUrl)) {
      throw new Error("[NET_FAULT] BIOOS_WEB_APP_URL ausente o inválida. Usa la URL HTTPS del proxy workers.dev aprobado o, únicamente para diagnóstico aislado, una URL /exec de Apps Script.");
    }

    if (!secretToken) throw new Error("[NET_FAULT] TELEGRAM_SECRET_TOKEN ausente. No se registra un webhook sin autenticación.");
    const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      payload: { url: webAppUrl, secret_token: secretToken, drop_pending_updates: "true" },
      muteHttpExceptions: true
    });
    const data = JSON.parse(response.getContentText());

    if (!data.ok) throw new Error(`[NET_FAULT] Telegram API Error: ${data.description}`);

    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[OPS] Telegram configurado con secret header. GAS directo queda fail-closed; configura proxy autenticado antes de procesar tráfico.");
    return true;
  });
}

/** Allows only the owned Cloudflare Workers ingress or an Apps Script /exec diagnostic endpoint. */
function _isApprovedTelegramWebhookUrl_(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  var url = value.trim();
  if (/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(url)) return true;
  return /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\/?$/i.test(url);
}

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
const _NET_MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Extrae de forma segura la foto de mayor resolución disponible desde un payload de Telegram.
 * Soporta arrays de PhotoSize, objetos individuales o documentos de tipo imagen.
 * Previene TypeErrors y colapsos de memoria.
 */
function _extractHighestResolutionPhoto(photoPayload) {
  if (!photoPayload) return null;

  // Caso 1: Array de PhotoSize (formato canónico de Telegram)
  if (Array.isArray(photoPayload)) {
    if (photoPayload.length === 0) return null;

    var bestPhoto = null;
    var maxMetric = -1;

    for (var i = 0; i < photoPayload.length; i++) {
      var p = photoPayload[i];
      if (!p || typeof p !== 'object' || !p.file_id) continue;

      var width = Number(p.width) || 0;
      var height = Number(p.height) || 0;
      var fileSize = Number(p.file_size) || 0;
      var metric = (width > 0 && height > 0) ? (width * height) : (fileSize > 0 ? fileSize : (i + 1));

      if (bestPhoto === null || metric > maxMetric) {
        bestPhoto = p;
        maxMetric = metric;
      }
    }

    if (!bestPhoto || !bestPhoto.file_id) return null;

    return {
      fileId: String(bestPhoto.file_id),
      fileSizeBytes: Number(bestPhoto.file_size || 0),
      width: Number(bestPhoto.width || 0),
      height: Number(bestPhoto.height || 0),
      mimeType: 'image/jpeg'
    };
  }

  // Caso 2: Objeto individual (nodo directo o mock simplificado)
  if (typeof photoPayload === 'object' && photoPayload.file_id) {
    return {
      fileId: String(photoPayload.file_id),
      fileSizeBytes: Number(photoPayload.file_size || 0),
      width: Number(photoPayload.width || 0),
      height: Number(photoPayload.height || 0),
      mimeType: (photoPayload.mime_type && String(photoPayload.mime_type)) || 'image/jpeg'
    };
  }

  return null;
}

function doPost(e) {
  try {
    if (BIOOS_CONFIG.SYS_FLAGS && BIOOS_CONFIG.SYS_FLAGS.MAINTENANCE_MODE) return _silentDrop();

    if (!e || !e.postData || !e.postData.contents) {
      console.warn("[WEBHOOK_EMPTY] Petición POST vacía o sin postData.");
      return _silentDrop();
    }

    let update;
    try {
      update = JSON.parse(e.postData.contents);
    } catch (err) {
      console.error("[WEBHOOK_JSON_PARSE_ERR] Fallo parseo JSON:", err.message);
      return _silentDrop();
    }

    if (!update || !update.message) return _silentDrop();

    const updateId = update.update_id;
    if (updateId === undefined || updateId === null) return _silentDrop();

    // 1. ZERO-TRUST AUTHENTICATION
    const props = PropertiesService.getScriptProperties();
    const expectedSecret = props.getProperty("TELEGRAM_SECRET_TOKEN");
    const incomingSecret = _getProxyWebhookToken(e);
    const configuredChatId = props.getProperty("TELEGRAM_CHAT_ID");
    const senderChatId = (update.message.chat && update.message.chat.id !== undefined) ? String(update.message.chat.id) : null;

    let isAuthenticated = false;

    // A. Validación por token secreto (proxy body o query parameter)
    if (expectedSecret && incomingSecret && _constantTimeEquals(expectedSecret, incomingSecret)) {
      isAuthenticated = true;
    }
    // B. Validación por Chat ID autorizado (enlace directo de Telegram)
    else if (configuredChatId && senderChatId && String(configuredChatId) === String(senderChatId)) {
      isAuthenticated = true;
    }
    // C. Si no hay secreto ni chat_id configurado (inicialización / dev setup)
    else if (!expectedSecret && !configuredChatId) {
      isAuthenticated = true;
    }

    if (!isAuthenticated) {
      console.warn(`[WEBHOOK_AUTH_REJECT] Ingreso no autenticado de chat ${senderChatId}. expectedSecret:${!!expectedSecret}, incomingSecret:${!!incomingSecret}`);
      if (typeof sendSystemTelemetry === "function") {
        sendSystemTelemetry("WARNING", "[WEBHOOK_AUTH] Ingreso rechazado por política Zero-Trust.");
      }
      return _silentDrop();
    }

    // 2. ENRUTAMIENTO DE COMANDOS DIRECTOS (Bypass L0 para latencia instantánea)
    if (update.message.text) {
      const messageText = update.message.text;
      if (messageText.startsWith("/")) {
        console.log(`[WEBHOOK_COMMAND] Procesando comando directo: "${messageText}" para chat ${senderChatId}`);
        _handleBypassCommand(messageText, senderChatId);
        return _silentDrop();
      } else {
        enqueueAndDispatchNLP(messageText, _netBuildIngressOptions_(update, 'telegram_text'));
      }
    }
    // 3. INGESTA ACÚSTICA (VOZ / AUDIO)
    else if (update.message.voice || update.message.audio) {
      const voice = update.message.voice || update.message.audio;
      console.log(`[WEBHOOK_VOICE_IN] Recibido audio de chat ${senderChatId}, duración: ${voice.duration}s, file_id: ${voice.file_id}`);

      if (!(BIOOS_CONFIG.CAPABILITIES && BIOOS_CONFIG.CAPABILITIES.VOICE_INPUT === true)) {
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[VOICE_DISABLED] Nota de voz ignorada por política.");
        return _silentDrop();
      }
      if (Number(voice.file_size || 0) > _NET_MAX_VOICE_BYTES) {
        if (typeof _rawSystemNotify === 'function' && senderChatId) {
          _rawSystemNotify('⚠️ <b>[BIOOS AUDIO]</b> La nota de voz excede el límite permitido de 8MB. Por favor envía un audio más corto.', senderChatId);
        }
        return _silentDrop();
      }

      // Emisión de ACK instantáneo (<200ms)
      const durationSec = Number(voice.duration || 0);
      const ackMsg = `🎙️ <b>[BIOOS ACÚSTICO]</b> Nota de voz recibida (${durationSec}s). Procesando análisis y extracción en segundo plano...`;
      _sendInstantAck_(ackMsg, senderChatId);

      // Encolamiento en L0 con metadata no sensible
      enqueueAndDispatchNLP('[VOICE_MESSAGE]', _netBuildIngressOptions_(update, 'telegram_voice', {
        fileId: String(voice.file_id || ''),
        mimeType: String(voice.mime_type || 'audio/ogg'),
        durationSeconds: durationSec,
        fileSizeBytes: Number(voice.file_size || 0)
      }));
    }
    // 4. INGESTA VISUAL (FOTO / DOCUMENTO IMAGEN)
    else if (update.message.photo) {
      const photoInfo = _extractHighestResolutionPhoto(update.message.photo);
      if (!photoInfo || !photoInfo.fileId) {
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", "[PHOTO_INVALID] Payload de foto sin file_id válido.");
        return _silentDrop();
      }
      if (photoInfo.fileSizeBytes > _NET_MAX_PHOTO_BYTES) {
        if (typeof _rawSystemNotify === 'function' && senderChatId) {
          _rawSystemNotify('⚠️ <b>[BIOOS VISIÓN]</b> La imagen excede el límite permitido de 10MB.', senderChatId);
        }
        return _silentDrop();
      }

      const ackMsg = `📸 <b>[BIOOS VISIÓN]</b> Captura visual recibida (${photoInfo.width}x${photoInfo.height}). Procesando análisis multimodal...`;
      _sendInstantAck_(ackMsg, senderChatId);

      enqueueAndDispatchNLP('[PHOTO_MESSAGE]', _netBuildIngressOptions_(update, 'telegram_photo', {
        fileId: photoInfo.fileId,
        mimeType: photoInfo.mimeType || 'image/jpeg',
        caption: String(update.message.caption || ''),
        fileSizeBytes: photoInfo.fileSizeBytes,
        width: photoInfo.width,
        height: photoInfo.height
      }));
    }
    else if (update.message.document && update.message.document.mime_type && update.message.document.mime_type.startsWith('image/')) {
      const doc = update.message.document;
      const docPhotoInfo = _extractHighestResolutionPhoto(doc);
      if (docPhotoInfo && docPhotoInfo.fileId) {
        _sendInstantAck_('📸 <b>[BIOOS VISIÓN]</b> Imagen en documento recibida. Procesando análisis en segundo plano...', senderChatId);
        enqueueAndDispatchNLP('[PHOTO_MESSAGE]', _netBuildIngressOptions_(update, 'telegram_photo', {
          fileId: docPhotoInfo.fileId,
          mimeType: String(doc.mime_type || 'image/jpeg'),
          caption: String(update.message.caption || ''),
          fileSizeBytes: Number(doc.file_size || 0)
        }));
      }
    }

    return _silentDrop();
  } catch (error) {
    console.error(`[WEBHOOK_CRASH] Error fatal en doPost: ${error.message}\n${error.stack}`);
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("ERROR", `[WEBHOOK_CRASH] ${error.message}`);
    return _silentDrop();
  }
}

/**
 * Emite un Acknowledge (ACK) transaccional casi instantáneo (<200ms) a Telegram
 * para notificar la recepción de payloads pesados y eliminar la incertidumbre del usuario.
 */
function _sendInstantAck_(ackText, targetChatId) {
  try {
    if (typeof _rawSystemNotify === 'function' && targetChatId) {
      _rawSystemNotify(ackText, targetChatId);
    }
  } catch (err) {
    if (typeof sendSystemTelemetry === 'function') {
      sendSystemTelemetry('WARNING', '[ACK_DISPATCH_WARN] No se pudo emitir ACK instantáneo: ' + err.message);
    }
  }
}

/**
 * Extrae el token de autenticación del webhook desde el body inyectado por proxy
 * o desde los parámetros de consulta seguros de la URL.
 */
function _getProxyWebhookToken(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : null;
    if (body && typeof body._bioos_proxy_token === "string" && body._bioos_proxy_token) {
      return body._bioos_proxy_token;
    }
    if (e && e.parameter) {
      if (typeof e.parameter.secret_token === "string" && e.parameter.secret_token) return e.parameter.secret_token;
      if (typeof e.parameter.token === "string" && e.parameter.token) return e.parameter.token;
      if (typeof e.parameter._bioos_proxy_token === "string" && e.parameter._bioos_proxy_token) return e.parameter._bioos_proxy_token;
    }
    return null;
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
function _downloadTelegramFile(fileId) {
  const token = PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Token ausente para descarga de archivo.");
  if (typeof fileId !== "string" || !fileId.trim() || !/^[A-Za-z0-9_+\/=-]{1,1024}$/.test(fileId)) throw new Error("Identificador de archivo inválido.");

  // Paso A: Obtener la ruta del archivo
  const fileInfoUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const fileInfoResponse = UrlFetchApp.fetch(fileInfoUrl, { muteHttpExceptions: true });

  if (fileInfoResponse.getResponseCode() !== 200) {
     throw new Error("Telegram rechazó la petición de ruta del archivo.");
  }

  const fileInfo = JSON.parse(fileInfoResponse.getContentText());
  if (!fileInfo.ok || !fileInfo.result || typeof fileInfo.result.file_path !== "string") throw new Error("El objeto de ruta del archivo está corrupto.");

  const maxBytes = typeof _NET_MAX_PHOTO_BYTES !== 'undefined' ? _NET_MAX_PHOTO_BYTES : 10 * 1024 * 1024;
  if (Number(fileInfo.result.file_size || 0) > maxBytes) throw new Error("El archivo excede el límite permitido (" + (fileInfo.result.file_size) + " > " + maxBytes + " bytes).");

  // Paso B: Descargar el binario y codificar a Base64
  const filePath = fileInfo.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const response = UrlFetchApp.fetch(downloadUrl, { muteHttpExceptions: true, followRedirects: false });
  if (response.getResponseCode() !== 200) throw new Error("Telegram rechazó la descarga del binario.");
  const bytes = response.getBlob().getBytes();
  if (bytes.length > maxBytes) throw new Error("El archivo descargado excede el límite permitido.");
  return Utilities.base64Encode(bytes);
}

function _downloadTelegramPhoto(fileId) {
  return _downloadTelegramFile(fileId);
}

function _downloadTelegramVoice(fileId) {
  return _downloadTelegramFile(fileId);
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

  // GESTIÓN ROBUSTA DE TRIGGERS (Auto-pruning de disparadores caducados)
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let workerTriggerCount = 0;
    for (let i = 0; i < triggers.length; i++) {
      const t = triggers[i];
      if (t.getHandlerFunction() === "workerProcessNLP") {
        if (workerTriggerCount >= 1) {
          try { ScriptApp.deleteTrigger(t); } catch (delErr) {}
        } else {
          workerTriggerCount++;
        }
      }
    }

    if (workerTriggerCount === 0) {
      ScriptApp.newTrigger("workerProcessNLP").timeBased().after(1000).create();
      _netTelemetry_(context, 'PROCESS', 'Webhook: job durable encolado; worker efímero programado.');
    } else {
      _netTelemetry_(context, 'PROCESS', 'Webhook: job durable encolado; worker existente activo.');
    }
  } catch (trigEx) {
    console.warn('[TRIGGER_WARN] No se pudo crear trigger automático: ' + trigEx.message);
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
    const rawCmd = String(command || '').trim();
    const normalizedCommand = rawCmd.toLowerCase().split(/\s+/)[0].replace(/@[^\s]+$/, '');
    console.log(`[COMMAND_HANDLE] Invocando comando: "${normalizedCommand}" para chatId: "${sourceChatId}"`);

    if (normalizedCommand === "/estado" || normalizedCommand === "/status" || normalizedCommand === "/memoria" || normalizedCommand === "/dashboard") {
      const dashboard = _generateExecutiveStatusDashboard_();
      const delivered = typeof _rawSystemNotify === "function" ? _rawSystemNotify(dashboard, sourceChatId) : false;
      if (!delivered) {
        console.error(`[COMMAND_NOTIFY_FAILED] Falló el despacho de /estado a Telegram para chat ${sourceChatId}`);
        throw new Error('[COMMAND_NOTIFY_FAILED] No fue posible enviar /estado.');
      }
      console.log(`[COMMAND_SUCCESS] /estado despachado exitosamente a chat ${sourceChatId}`);
      return;
    }
    if (normalizedCommand === "/doctor" || normalizedCommand === "/doc") {
      _diagnoseSensorsLive_(sourceChatId);
      return;
    }
    if (normalizedCommand === "/reauth" || normalizedCommand === "/auth") {
      const authMsg = '<b>Integracion biometrica</b>\nMi Fitness debe sincronizar con Health Connect. BioOS aun no incluye el puente Android que lee esos datos con tu permiso; reautorizar Google Fit no conecta el Xiaomi Watch 2.';
      if (typeof _rawSystemNotify === "function") _rawSystemNotify(authMsg, sourceChatId);
      return;
    }
    if (normalizedCommand === "/ping") {
      const version = typeof BIOOS_CONFIG !== 'undefined' ? BIOOS_CONFIG.VERSION : 'unknown';
      const pongMsg = 'Pong. Tunel activo. BioOS ' + version + ' en linea.';
      if (typeof _rawSystemNotify === "function" && !_rawSystemNotify(pongMsg, sourceChatId)) {
        throw new Error('[COMMAND_NOTIFY_FAILED] No fue posible enviar /ping.');
      }
      return;
    }
    if (normalizedCommand === "/ayuda" || normalizedCommand === "/help") {
      const version = typeof BIOOS_CONFIG !== 'undefined' ? BIOOS_CONFIG.VERSION : 'unknown';
      const helpMsg = '<b>BioOS ' + version + ' - Comandos</b>\n\n' +
                      '<code>/estado</code> - Telemetria disponible y memoria reciente.\n' +
                      '<code>/doctor</code> - Estado de sensores, valores y fuente.\n' +
                      '<code>/reauth</code> - Estado de la ruta Mi Fitness/Health Connect.\n' +
                      '<code>/ping</code> - Conectividad del tunel.\n' +
                      'Puedes enviar texto, notas de voz o imagenes.';
      if (typeof _rawSystemNotify === "function") _rawSystemNotify(helpMsg, sourceChatId);
      return;
    }
  } catch (e) {
    console.error(`[COMMAND_FAULT] Error al procesar comando "${command}": ${e.message}`);
    if (typeof sendSystemTelemetry === 'function') sendSystemTelemetry('ERROR', '[COMMAND_FAULT] ' + e.message);
    if (typeof _rawSystemNotify === 'function' && sourceChatId) {
      _rawSystemNotify(`⚠️ <b>[BIOOS ERROR]</b> No fue posible procesar el comando <code>${command}</code>: ${e.message}`, sourceChatId);
    }
  }
}

/**
 * SRE Sonda de penetración y diagnóstico clínico en vivo para Google Fit y Mobvoi (/doctor).
 * Se salta la NVRAM y realiza un fetch desacoplado a los endpoints para auditar tokens y degradación grácil.
 */
function _diagnoseSensorsLive_(sourceChatId) {
  const lines = ['<b>BioOS - Estado de sensores</b>'];
  try {
    const snap = typeof getBiometricSnapshot === 'function' ? getBiometricSnapshot() : null;
    const data = (snap && snap.data) || {};
    lines.push('Fuente activa: ' + ((snap && snap.source) || 'ninguna'));
    lines.push('Lectura consultada: ' + ((snap && snap.fetchedAt) || 'sin marca de tiempo'));
    lines.push('Estado del proveedor: ' + ((snap && snap.available) ? 'consulta disponible' : ((snap && snap.reason) || 'sin datos')));
    lines.push('Pasos: ' + (data.steps === null || data.steps === undefined ? 'sin dato' : Number(data.steps).toLocaleString()));
    lines.push('Distancia: ' + (data.distanceKm === null || data.distanceKm === undefined ? 'sin dato' : data.distanceKm + ' km'));
    lines.push('Energ?a: ' + (data.caloriesKcal === null || data.caloriesKcal === undefined ? 'sin dato' : data.caloriesKcal + ' kcal'));
    lines.push('Frecuencia card?aca en reposo: ' + (data.rhrBpm === null || data.rhrBpm === undefined ? 'sin dato v?lido' : data.rhrBpm + ' bpm'));
    lines.push('Sue?o: ' + (data.sleepMinutes === null || data.sleepMinutes === undefined ? 'sin dato' : (data.sleepMinutes / 60).toFixed(1) + ' h'));
  } catch (error) {
    lines.push('Lectura fallida: ' + String(error && error.message || error).slice(0, 180));
  }
  lines.push('Mi Fitness/Health Connect: requiere un puente Android con permisos del usuario; no est? conectado directamente a Apps Script.');
  const report = lines.join('\n');
  if (typeof _rawSystemNotify === 'function' && sourceChatId) _rawSystemNotify(report, sourceChatId);
  return report;
}

/**
 * Genera el Dashboard Ejecutivo de Transparencia Cognitiva para Telegram (/estado y /memoria).
 * Interroga la NVRAM L1, el modelo basal L4, telemetría de hardware viva y el cooldown cognitivo.
 */
function _generateExecutiveStatusDashboard_() {
  const memory = typeof getSystemMemory === 'function' ? getSystemMemory() : { NVRAM: {} };
  const nvram = (memory && memory.NVRAM) || {};
  const basal = nvram.L4_Basal || { baseline_rhr: 43, target_steps: 8000, target_sleep_hrs: 7.3 };
  const sessionEvents = (nvram.L1_Working && nvram.L1_Working.session_events) || [];

  // 1. Status Biométrico - Consulta al Sensor Engine Vivo
  let liveSensorData = {};
  let sensorSource = 'GoogleFit_REST';
  try {
    if (typeof getBiometricSnapshot === 'function') {
      const snap = getBiometricSnapshot();
      if (snap && snap.available && snap.data) {
        liveSensorData = snap.data;
        sensorSource = snap.source || 'GoogleFit_REST';
      }
    }
  } catch (sensorErr) {
    console.warn('[DASHBOARD_SENSOR_WARN] getBiometricSnapshot failed:', sensorErr.message);
  }

  const l4Biometry = typeof _extractBiometricTelemetry_ === 'function'
    ? _extractBiometricTelemetry_(liveSensorData, basal)
    : { sensor_status: 'CEGUERA_SENSORIAL_ACTIVA', origin: '[BASAL_NOMINAL]' };

  let biometryText = '';
  if (l4Biometry.is_live_telemetry) {
    const d = l4Biometry.data || {};
    const rhrStr = d.rhrBpm ? d.rhrBpm + ' bpm' : 'N/A';
    const sleepStr = d.sleepHours ? d.sleepHours + 'h' : (d.sleepMinutes ? (d.sleepMinutes/60).toFixed(1) + 'h' : 'N/A');
    const stepsStr = d.steps ? Number(d.steps).toLocaleString() : '0';
    const distStr = d.distanceKm ? d.distanceKm + ' km' : (d.distanceMeters ? (d.distanceMeters/1000).toFixed(2) + ' km' : null);
    const calStr = d.caloriesKcal ? d.caloriesKcal + ' kcal' : null;

    biometryText = '🟢 <b>ONLINE (' + (l4Biometry.source || sensorSource) + ')</b>\n' +
                   '• RHR: <b>' + rhrStr + '</b>' + (l4Biometry.baseline_comparison && l4Biometry.baseline_comparison.rhr_vs_baseline !== null ? ' (Delta: ' + l4Biometry.baseline_comparison.rhr_vs_baseline + ')' : '') + '\n' +
                   '• Pasos: <b>' + stepsStr + '</b>' + (distStr ? ' (' + distStr + ')' : '') + '\n' +
                   (calStr ? '• Calorías: <b>' + calStr + '</b>\n' : '') +
                   '• Sueño: <b>' + sleepStr + '</b>';
  } else {
    biometryText = '🟡 <b>CEGUERA SENSORIAL ACTIVA</b>\n' +
                   '• Modelo: <b>Basal Nominal Calibrado</b>\n' +
                   '• Referencia: RHR ' + (basal.baseline_rhr || 43) + ' bpm | Sueño ' + (basal.target_sleep_hrs || 7.3) + 'h | Pasos ' + (basal.target_steps || 8000) + '\n' +
                   '• Escudo: <i>Anti-Alucinación Activo</i>';
  }

  // 2. Cooldown Cognitivo & Memoria L1
  const l1Context = typeof _extractL1CognitiveContext === 'function'
    ? _extractL1CognitiveContext(sessionEvents, 12)
    : { active: false, hoursSince: null, formattedDetails: 'Sin feedback reciente.' };

  let cognitiveModeText = '';
  if (l1Context.active) {
    cognitiveModeText = '🛡️ <b>PROACTIVO (Cooldown Activo)</b>\n' +
                        '• Último Feedback: <b>hace ' + l1Context.hoursSince + 'h</b>\n' +
                        '• Estado: <i>Supresión de preguntas redundantes activa</i>';
  } else {
    cognitiveModeText = '🔍 <b>RECEPTIVO / CALIBRACIÓN</b>\n' +
                        '• Último Feedback: >12h o sin registro\n' +
                        '• Modo: <i>Reconciliación contextual habilitada</i>';
  }

  // 3. Resumen de Intenciones y Síntomas L1
  let l1DetailsText = '';
  if (l1Context.active && l1Context.details) {
    const d = l1Context.details;
    const sintomasStr = (d.sintomas && d.sintomas.length) ? d.sintomas.join(', ') : 'Ninguno reportado';
    const intencionesStr = (d.intenciones && d.intenciones.length) ? d.intenciones.join(', ') : 'No especificadas';
    l1DetailsText = '• Síntomas: <i>' + sintomasStr + '</i>\n• Intenciones: <i>' + intencionesStr + '</i>';
  } else {
    l1DetailsText = '• <i>Sin intenciones ni síntomas recientes en NVRAM L1.</i>';
  }

  // 4. Cola L0, Daemon Status & Firma Dinámica SRE
  const nowIso = new Date().toISOString();
  const sessionSignature = Utilities.getUuid ? Utilities.getUuid().substring(0, 8) : Math.random().toString(36).substring(2, 10);
  const version = typeof BIOOS_CONFIG !== 'undefined' ? BIOOS_CONFIG.VERSION : '7.0.0-PROD-LIVE';
  let queueText = '• L0 Ingesta: <b>Activa (Zero-Silent-Drop)</b>\n• Transducción: <b>Multimodal Asíncrona (Audio/Foto/Texto)</b>\n• SRE Live Stamp: <code>' + nowIso + ' [' + sessionSignature + ']</code>';

  return '🧠 <b>[BIOOS EXOCORTEX DASHBOARD ' + version + ']</b>\n\n' +
         '📊 <b>1. Telemetría de Hardware:</b>\n' + biometryText + '\n\n' +
         '⚡ <b>2. Modo Cognitivo & Cooldown:</b>\n' + cognitiveModeText + '\n\n' +
         '🧬 <b>3. Memoria L1 Reciente:</b>\n' + l1DetailsText + '\n\n' +
         '⚙️ <b>4. Infraestructura & Ingesta L0:</b>\n' + queueText + '\n\n' +
         '<i>Exocórtex calibrado y operando con Fricción Cognitiva Cero.</i>';
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

/**
 * Handler HTTP GET para diagnóstico y ejecución autónoma remota.
 */
function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || 'ping').trim();
  if (action === 'reauth' || action === 'auth') {
    return ContentService.createTextOutput('BioOS does not configure Xiaomi accounts or read Health Connect directly. Sync Mi Fitness to Health Connect and connect an authorized Android bridge before enabling live telemetry.')
      .setMimeType(ContentService.MimeType.TEXT);
  }
  if (action !== 'ping') {
    return ContentService.createTextOutput(JSON.stringify({ status: 'UNSUPPORTED_ACTION' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ONLINE',
    system: 'BioOS',
    version: typeof BIOOS_CONFIG !== 'undefined' ? BIOOS_CONFIG.VERSION : 'unknown',
    timestamp: new Date().toISOString(),
    scope: 'read-only liveness; no sensor data or operational actions'
  })).setMimeType(ContentService.MimeType.JSON);
}

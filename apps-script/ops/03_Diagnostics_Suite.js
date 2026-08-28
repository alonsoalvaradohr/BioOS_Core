/**
 * ==============================================================================
 * ARCHIVO: ops/03_Diagnostics_Suite.js
 * SISTEMA: BioOS v5.1 (Operaciones & Diagnóstico SRE)
 * DESCRIPCIÓN: Pipeline de pruebas unitarias, validación de VFS, latencia y despacho.
 * ==============================================================================
 */

/**
 * Prueba de lectura y escritura de alta velocidad en NVRAM y ROM (VFS).
 */
function testMemoryReadWrite() {
  console.log("[TEST_VFS] Iniciando prueba de lectura/escritura en memoria persistente...");
  const results = {
    timestamp: new Date().toISOString(),
    readOk: false,
    writeOk: false,
    readLatencyMs: 0,
    writeLatencyMs: 0,
    romId: "",
    nvramId: "",
    romVersion: "",
    nvramSchema: 0,
    summary: "FAIL"
  };

  // 1. Prueba de Lectura
  const readStart = Date.now();
  try {
    const memory = getSystemMemory();
    results.readLatencyMs = Date.now() - readStart;
    results.romVersion = (memory && memory.ROM && memory.ROM._version) || "UNKNOWN";
    results.nvramSchema = (memory && memory.NVRAM && memory.NVRAM._bioos_memory_schema) || 0;
    
    const p = PropertiesService.getScriptProperties();
    results.romId = p.getProperty("VFS_ROM_ID") || _DEFAULT_VFS_ROM_ID;
    results.nvramId = p.getProperty("VFS_NVRAM_ID") || _DEFAULT_VFS_NVRAM_ID;
    results.readOk = true;
    console.log(`[TEST_VFS_READ] Lectura completada en ${results.readLatencyMs}ms. Versión ROM: ${results.romVersion}`);
  } catch (readErr) {
    console.error(`[TEST_VFS_READ_ERR] ${readErr.message}`);
    results.readError = readErr.message;
  }

  // 2. Prueba de Escritura / Mutación
  const writeStart = Date.now();
  try {
    const testProbe = { probeId: "test-" + Date.now(), timestamp: new Date().toISOString() };
    const anxiety = ingestWorkingMemory("TEST_PROBE", testProbe);
    results.writeLatencyMs = Date.now() - writeStart;
    results.writeOk = true;
    console.log(`[TEST_VFS_WRITE] Escritura L1 completada en ${results.writeLatencyMs}ms. Anxiety: ${anxiety}`);
  } catch (writeErr) {
    console.error(`[TEST_VFS_WRITE_ERR] ${writeErr.message}`);
    results.writeError = writeErr.message;
  }

  results.summary = (results.readOk && results.writeOk) ? "PASS" : "FAIL";
  console.log("[TEST_VFS_RESULT]", JSON.stringify(results, null, 2));
  return results;
}

/**
 * Prueba y valida el despacho matutino con métricas biométricas enriquecidas (04:30).
 */
function testMorningBriefingPayload() {
  console.log("[TEST_MORNING] Iniciando prueba de despacho matutino con contexto fisiológico...");
  const startTime = Date.now();

  const payload = {
    testRun: true,
    testSteps: 1250,
    testRhr: 43,
    testSleepMinutes: 440,
    initiatedAt: new Date().toISOString()
  };

  const success = routeCognitiveTask("MORNING_BRIEFING", payload);
  const elapsed = Date.now() - startTime;

  const result = {
    event: "MORNING_BRIEFING",
    success: !!success,
    durationMs: elapsed,
    timestamp: new Date().toISOString(),
    status: success ? "DESPACHADO_A_TELEGRAM" : "FALLO_EN_DESPACHO"
  };

  console.log(`[TEST_MORNING_RESULT] Despacho matutino completado en ${elapsed}ms. Éxito: ${success}`);
  return result;
}

/**
 * Prueba y valida el despacho vespertino con balance de actividad y sueño (19:30).
 */
function testNightBriefingPayload() {
  console.log("[TEST_NIGHT] Iniciando prueba de despacho vespertino con balance de jornada...");
  const startTime = Date.now();

  const payload = {
    testRun: true,
    testSteps: 8650,
    testRhr: 44,
    testSleepMinutes: 430,
    initiatedAt: new Date().toISOString()
  };

  const success = routeCognitiveTask("EVENING_BRIEFING", payload);
  const elapsed = Date.now() - startTime;

  const result = {
    event: "EVENING_BRIEFING",
    success: !!success,
    durationMs: elapsed,
    timestamp: new Date().toISOString(),
    status: success ? "DESPACHADO_A_TELEGRAM" : "FALLO_EN_DESPACHO"
  };

  console.log(`[TEST_NIGHT_RESULT] Despacho vespertino completado en ${elapsed}ms. Éxito: ${success}`);
  return result;
}

/**
 * Prueba y valida la auditoría táctica dominical (Bucle Semanal).
 */
function testWeeklyAuditPayload() {
  console.log("[TEST_WEEKLY] Iniciando prueba de Auditoría Táctica Dominical...");
  const startTime = Date.now();
  const res = typeof executeWeeklyAudit === "function" ? executeWeeklyAudit() : { success: false, error: "executeWeeklyAudit no disponible" };
  const elapsed = Date.now() - startTime;
  return {
    event: "WEEKLY_AUDIT",
    success: !!(res && res.success),
    delivered: !!(res && res.delivered),
    durationMs: elapsed,
    timestamp: new Date().toISOString(),
    status: res && res.delivered ? "DESPACHADO_A_TELEGRAM" : "PROCESADO_INTERNO",
    auditSummary: res && res.audit ? res.audit.resumen_ejecutivo : null
  };
}

/**
 * Prueba y valida el ciclo de auto-tuning y meta-evolución (Bucle Mensual).
 */
function testMetaEvolutionPayload() {
  console.log("[TEST_META] Iniciando prueba del Ciclo Mensual de Meta-Evolución...");
  const startTime = Date.now();
  const res = typeof executeMonthlyMetaEvolution === "function" ? executeMonthlyMetaEvolution() : { success: false, error: "executeMonthlyMetaEvolution no disponible" };
  const elapsed = Date.now() - startTime;
  return {
    event: "MONTHLY_META_EVOLUTION",
    success: !!(res && res.success),
    delivered: !!(res && res.delivered),
    durationMs: elapsed,
    timestamp: new Date().toISOString(),
    status: res && res.delivered ? "DESPACHADO_A_TELEGRAM" : "PROCESADO_INTERNO",
    adjustedWeights: res && res.evolution ? res.evolution.pesos_ajustados : null
  };
}

/**
 * Prueba la conectividad y validez de todas las credenciales del sistema.
 */
function testCredenciales() {
  const results = {
    timestamp: new Date().toISOString(),
    telegram: { ok: false, detail: "" },
    gemini: { ok: false, detail: "" },
    drive: { ok: false, detail: "" },
    sheets: { ok: false, detail: "" },
    summary: "EN EVALUACIÓN"
  };

  // 1. Telegram
  try {
    const props = PropertiesService.getScriptProperties();
    const rawToken = props.getProperty("TELEGRAM_BOT_TOKEN");
    const rawChatId = props.getProperty("TELEGRAM_CHAT_ID");
    const token = rawToken ? String(rawToken).trim() : null;
    const chatId = rawChatId ? String(rawChatId).trim() : null;

    if (!token || !chatId) {
      results.telegram.detail = "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.";
    } else {
      const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      const json = JSON.parse(res.getContentText());
      if (res.getResponseCode() === 200 && json.ok) {
        results.telegram.ok = true;
        results.telegram.detail = `Bot: @${json.result.username} (ID: ${json.result.id}, Chat: ${chatId})`;
      } else {
        results.telegram.detail = `HTTP ${res.getResponseCode()}: ${json.description || 'Error'}`;
      }
    }
  } catch (err) {
    results.telegram.detail = `Excepción: ${err.message}`;
  }

  // 2. Gemini API
  try {
    const answer = invokeUniversalLLM(
      "Eres un evaluador de latencia y conectividad.",
      "Responde con la palabra: CONECTADO",
      null,
      0.0
    );
    if (answer && String(answer).trim().length > 0) {
      results.gemini.ok = true;
      results.gemini.detail = `Respuesta exitosa: "${String(answer).trim().substring(0, 50)}"`;
    }
  } catch (err) {
    results.gemini.detail = `Excepción Gemini: ${err.message}`;
  }

  // 3. Drive (VFS)
  try {
    const vfsNodes = _getVfsNodes();
    if (vfsNodes && vfsNodes.romFile && vfsNodes.nvramFile) {
      results.drive.ok = true;
      results.drive.detail = `ROM: ${vfsNodes.romFile.getId()} | NVRAM: ${vfsNodes.nvramFile.getId()}`;
    }
  } catch (err) {
    results.drive.detail = `Excepción VFS: ${err.message}`;
  }

  // 4. Sheets (DB)
  try {
    const dbCheck = _opsCheckDatabase_();
    results.sheets.ok = dbCheck.status === "PASS";
    results.sheets.detail = dbCheck.message;
  } catch (err) {
    results.sheets.detail = `Excepción DB: ${err.message}`;
  }

  results.summary = (results.telegram.ok && results.gemini.ok && results.drive.ok && results.sheets.ok) ? "PASS" : "FAIL";
  return results;
}

/**
 * Simula y ejecuta un ciclo completo de envío programado.
 */
function testEnvioProgramado(tipo = "MORNING_BRIEFING") {
  return tipo === "EVENING_BRIEFING" ? testNightBriefingPayload() : testMorningBriefingPayload();
}

/**
 * Inspecciona todos los disparadores instalados en el proyecto de Google Apps Script.
 */
function diagnosticoDisparadores() {
  const triggers = ScriptApp.getProjectTriggers();
  const tz = (typeof BIOOS_CONFIG !== 'undefined' && BIOOS_CONFIG.TIMING && BIOOS_CONFIG.TIMING.TIMEZONE)
    ? BIOOS_CONFIG.TIMING.TIMEZONE : "America/Costa_Rica";

  const triggerInfo = triggers.map((t, idx) => ({
    index: idx,
    uniqueId: t.getUniqueId(),
    handlerFunction: t.getHandlerFunction(),
    eventType: String(t.getEventType()),
    triggerSource: String(t.getTriggerSource())
  }));

  const morningTrigger = triggerInfo.find(t => t.handlerFunction === "triggerMorningBriefing");
  const eveningTrigger = triggerInfo.find(t => t.handlerFunction === "triggerEveningBriefing");

  return {
    totalTriggers: triggers.length,
    configuredTimezone: tz,
    morningBriefingConfigured: !!morningTrigger,
    eveningBriefingConfigured: !!eveningTrigger,
    allTriggers: triggerInfo,
    status: (morningTrigger && eveningTrigger) ? "OPERATIVO" : "INCOMPLETO_REQUIERE_RECONCILIACION"
  };
}

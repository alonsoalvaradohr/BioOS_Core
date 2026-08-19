/**
 * ==============================================================================
 * ARCHIVO: 09_SRE_DeepDebug.gs
 * SISTEMA: BioOS v4.1 (Arquitectura SRE)
 * DESCRIPCIÓN: Agente SRE (Site Reliability Engineer).
 * HITO 0.3: Castración de Hot-Swap. Diagnóstico Read-Only y propuesta por Telegram.
 * ==============================================================================
 */

function analyzeAndPatchRootCause(failedTask, errorMessage, errorStack) {
  if (typeof sendSystemTelemetry === "function") {
    sendSystemTelemetry("SRE", `[DeepDebug] Iniciando Análisis de Causa Raíz (RCA) para: ${failedTask}`);
  }

  // 1. Filtro de Errores Deterministas (Infraestructura)
  if (_evaluateDeterministicRules(failedTask, errorMessage)) return;

  // 2. Extracción Read-Only de la Memoria
  if (typeof sendSystemTelemetry === "function") {
    sendSystemTelemetry("PROCESS", `[DeepDebug] Extrayendo ROM activa para diagnóstico lógico...`);
  }

  const memory = getSystemMemory();
  const romPrompts = memory.ROM.agent_prompts;

  const rcaSchema = {
    "type": "OBJECT",
    "properties": {
      "causa_raiz_identificada": { "type": "STRING", "description": "Explicación técnica del fallo." },
      "clasificacion_error": {
        "type": "STRING",
        "enum": ["JSON_SCHEMA_MISMATCH", "PROMPT_HALLUCINATION", "CONTEXT_OVERFLOW", "SPADE_DEADLOCK", "UNKNOWN_LOGIC_FAULT"]
      },
      "agente_afectado": { "type": "STRING", "nullable": true, "description": "Nombre de la llave del agente en la ROM." },
      "propuesta_parche": { "type": "STRING", "nullable": true, "description": "El texto del nuevo prompt propuesto para solucionar la falla." }
    },
    "required": ["causa_raiz_identificada", "clasificacion_error"]
  };

  const srePrompt = `Eres el Agente SRE de BioOS v4.1.
Tu tarea es realizar un Análisis de Causa Raíz (RCA) de un colapso en tiempo de ejecución.

Proceso Colapsado: ${failedTask}
Mensaje de Error: ${errorMessage}
Stack Trace: ${errorStack}

ROM Actual (Prompts de Agentes):
${JSON.stringify(romPrompts, null, 2)}

Instrucción SRE: Identifica la causa del fallo. Si es un error de formato, alucinación o desvío de esquema por parte de un agente, genera una 'propuesta_parche' con instrucciones más estrictas.
[REGLA SRE DE HIERRO]: TIENES ESTRICTAMENTE PROHIBIDO APLICAR EL PARCHE O MUTAR LA ROM DIRECTAMENTE. Solo genera la propuesta para revisión humana.`;

  try {
    const rcaReport = invokeUniversalLLM(srePrompt, "Ejecutar RCA en modo Read-Only.", rcaSchema, 0.0);

    if (typeof sendSystemTelemetry === "function") {
      sendSystemTelemetry("SRE", `[DeepDebug] Diagnóstico: ${rcaReport.clasificacion_error}.`);
    }

    // 3. Notificación a Telegram (Sin ejecución automática)
    let telegramMessage = `🔧 <b>BioOS Auto-Reparación (SRE)</b>\n\nEl sistema colapsó en <code>${failedTask}</code>.\n<b>Diagnóstico:</b> ${rcaReport.clasificacion_error}\n<b>Causa:</b> ${rcaReport.causa_raiz_identificada}`;

    if (rcaReport.propuesta_parche && rcaReport.agente_afectado) {
      telegramMessage += `\n\n<b>Parche Propuesto para [${rcaReport.agente_afectado}]:</b>\n<i>${rcaReport.propuesta_parche.substring(0, 400)}...</i>\n\n⚠️ <i>La mutación automática de ROM está deshabilitada. Actualiza la ROM manualmente en el código si apruebas este parche.</i>`;
    }

    if (typeof _rawSystemNotify === "function") {
      _rawSystemNotify(telegramMessage);
    }

  } catch (llmError) {
    if (typeof sendSystemTelemetry === "function") {
      sendSystemTelemetry("FATAL", `[DeepDebug] Abortado: ${llmError.message}`);
    }
  }
}

/**
 * Evalúa si el error es de infraestructura (Google) y aborta el RCA para ahorrar cuota LLM.
 */
function _evaluateDeterministicRules(failedTask, errorMessage) {
  const errUpper = errorMessage.toUpperCase();

  if (errUpper.includes("EXCEEDED MAXIMUM EXECUTION TIME") || errUpper.includes("WATCHDOG_TIMEOUT")) {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[DeepDebug] Determinista: Inanición de Hilos (Timeout de Google). El sistema se auto-restaurará.`);
    return true;
  }

  if (errUpper.includes("LOCKSERVICE") || errUpper.includes("MUTEX_TIMEOUT") || errUpper.includes("MUTEX_DEADLOCK")) {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[DeepDebug] Determinista: Contención de Mutex en VFS. Ignorando.`);
    return true;
  }

  if (errUpper.includes("URLFETCHAPP") && (errUpper.includes("500") || errUpper.includes("503") || errUpper.includes("429"))) {
    if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[DeepDebug] Determinista: API externa caída o Rate Limit. Ignorando.`);
    return true;
  }

  return false;
}

/**
 * Compatibilidad con configuraciones antiguas. El reset destructivo fue retirado:
 * nunca se debe enviar a la papelera una carpeta elegida solo por nombre.
 */
function executeFactoryResetVFS() {
  throw new Error(
    "[FACTORY_RESET_DISABLED] El reset destructivo fue retirado. " +
    "Use copias verificadas y repairNVRAMFromRecoverySlot('A'|'B')."
  );
}

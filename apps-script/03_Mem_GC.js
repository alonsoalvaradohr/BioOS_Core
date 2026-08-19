/**
 * ==============================================================================
 * ARCHIVO: 03_Mem_GC.gs
 * SISTEMA: BioOS v4.1 (Arquitectura SRE)
 * DESCRIPCIÓN: Agente de Memoria Jerárquica y Consolidación (L2 -> L3).
 * ==============================================================================
 */

function forceContextCompaction() {
  return executeWithResilience("GC_Compaction_L1_L2", () => {
      const nvram = getSystemMemory().NVRAM;

      if (!nvram.L1_Working.context_anxiety_flag && (!nvram.L1_Working.session_events || nvram.L1_Working.session_events.length === 0)) {
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("GC", "[GC] Omitido. Búfer L1 limpio.");
        return false;
      }

      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("GC", `[RATE-DISTORTION] Iniciando compresión L1 -> L2.`);

      const systemPersona = "Eres un Motor de Análisis de Datos de Sistema.";

      // Slicing de Array seguro: Mantiene la estructura JSON intacta
      const eventosAcotados = (nvram.L1_Working.session_events || []).slice(-15);

      const prompt = `Comprime el siguiente registro de eventos del sistema eliminando redundancias.

Registros:
${JSON.stringify(eventosAcotados)}

DEBES DEVOLVER EXCLUSIVAMENTE UN OBJETO JSON con esta estructura exacta:
{
  "intencion_sesion": "Propósito principal detectado",
  "tendencias_biometricas": "Resumen de métricas detectadas",
  "intervenciones_adoptadas": "Acciones tomadas por el sistema",
  "hechos_relevantes_nvram": "Eventos críticos"
}`;

      let l2EpisodicData;
      try {
        const rawResponse = invokeUniversalLLM(systemPersona, prompt, null, 0.1);
        const parsed = Core_parseStructuredJson(rawResponse, { expectedType: 'object' });
        if (!parsed.ok) throw new Error('[PARSE_FAULT] ' + parsed.error.message);
        l2EpisodicData = parsed.value;
      } catch (llmError) {
        // [INTERCEPTOR SRE] Absorbe el fallo de API/Parseo sin colapsar el sistema
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[GC] Compresión L1 abortada por falla de IA: ${llmError.message}. Búfer preservado.`);
        return false;
      }

      mutateNVRAM(state => {
        if (!state.L2_Episodic.weekly_archives) state.L2_Episodic.weekly_archives = [];
        state.L2_Episodic.weekly_archives.push({ timestamp: new Date().toISOString(), archive: l2EpisodicData });
        // Conserva eventos recibidos mientras el LLM trabajaba.
        const compacted = eventosAcotados.map(event => JSON.stringify(event));
        state.L1_Working.session_events = (state.L1_Working.session_events || []).filter(event => compacted.indexOf(JSON.stringify(event)) === -1);
        state.L1_Working.context_anxiety_flag = state.L1_Working.session_events.length > 0;
      }, "GC_Compaction_Commit");

      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("SUCCESS", `[GC] L1 comprimido en L2 Episódica.`);
      return true;
  });
}

function triggerWeeklySemanticConsolidation() {
  return executeWithResilience("GC_Consolidation_L2_L3_CMO", () => {
      const nvram = getSystemMemory().NVRAM;

      const hasArchives = nvram.L2_Episodic.weekly_archives && nvram.L2_Episodic.weekly_archives.length > 0;
      const hasDataLake = nvram.L2_Episodic.raw_data_lake && nvram.L2_Episodic.raw_data_lake.length > 0;

      if (!hasArchives && !hasDataLake) {
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("GC", "Consolidación omitida. L2 vacío.");
        return false;
      }

      if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("PROCESS", `[GC] Iniciando Minería de Datos (L2 -> L3)...`);

      const systemPersona = "Eres un Motor de Procesamiento de Datos. Extrae patrones numéricos y variaciones de estado de archivos JSON de telemetría.";

      // Slicing de Arrays para evitar TPM Limit sin romper sintaxis JSON
      const archivosAcotados = (nvram.L2_Episodic.weekly_archives || []).slice(-10);
      const dataLakeAcotado = (nvram.L2_Episodic.raw_data_lake || []).slice(-10);

      const prompt = `Analiza los siguientes arrays de datos de sensores y logs de sistema.
Extrae eventos anómalos y variaciones numéricas. Prohibido generar lenguaje médico.

Historial Episódico:
${JSON.stringify(archivosAcotados)}

Data Lake (Sensores):
${JSON.stringify(dataLakeAcotado)}

DEBES DEVOLVER EXCLUSIVAMENTE UN OBJETO JSON con esta estructura exacta:
{
  "anomalias_estado": ["lista de alertas o estados inusuales encontrados"],
  "variaciones_metricas": ["lista de tendencias numéricas detectadas"],
  "sintesis_estadistica": "Resumen técnico de 2 líneas"
}`;

      let l3SemanticData;
      try {
        const rawResponse = invokeUniversalLLM(systemPersona, prompt, null, 0.1);
        const parsed = Core_parseStructuredJson(rawResponse, { expectedType: 'object' });
        if (!parsed.ok) throw new Error('[PARSE_FAULT] ' + parsed.error.message);
        l3SemanticData = parsed.value;
      } catch (llmError) {
        // [INTERCEPTOR SRE] Absorbe el fallo crítico de la red o filtro de seguridad.
        if (typeof sendSystemTelemetry === "function") sendSystemTelemetry("WARNING", `[CMO] Minería suspendida por falla externa: ${llmError.message}. Datos L2 asegurados.`);
        return false;
      }

      mutateNVRAM(state => {
        if (!state.L3_Semantic.medical_knowledge_graph) state.L3_Semantic.medical_knowledge_graph = { lesiones_activas: [], tendencias_metabolicas: [] };
        state.L3_Semantic.medical_knowledge_graph.lesiones_activas = Array.isArray(l3SemanticData.anomalias_estado) ? l3SemanticData.anomalias_estado : [l3SemanticData.anomalias_estado];
        state.L3_Semantic.medical_knowledge_graph.tendencias_metabolicas = Array.isArray(l3SemanticData.variaciones_metricas) ? l3SemanticData.variaciones_metricas : [l3SemanticData.variaciones_metricas];
        // Solo elimina los elementos analizados; no borra ingestas concurrentes.
        const archiveKeys = archivosAcotados.map(item => JSON.stringify(item));
        const lakeKeys = dataLakeAcotado.map(item => JSON.stringify(item));
        state.L2_Episodic.weekly_archives = (state.L2_Episodic.weekly_archives || []).filter(item => archiveKeys.indexOf(JSON.stringify(item)) === -1);
        state.L2_Episodic.raw_data_lake = (state.L2_Episodic.raw_data_lake || []).filter(item => lakeKeys.indexOf(JSON.stringify(item)) === -1);
      }, "GC_Consolidation_Commit");

      if (typeof sendSystemTelemetry === "function") {
        const dictamen = l3SemanticData.sintesis_estadistica ? String(l3SemanticData.sintesis_estadistica).substring(0, 150) : "S/D";
        sendSystemTelemetry("SUCCESS", `[GC] L3 actualizado. Data Lake purgado.\nSíntesis: ${dictamen}...`);
      }
      return true;
  });
}

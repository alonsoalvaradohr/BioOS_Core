/**
 * ==============================================================================
 * ARCHIVO: 00_Sys_Config.gs
 * SISTEMA: BioOS v5.0 (Autonomous Cognitive Kernel)
 * DESCRIPCIÓN: ROM Inmutable del Kernel. Banderas SRE, topología del enjambre,
 * umbrales de Tasa-Distorsión y estructura de memoria jerárquica.
 * IMPORTANTE: El objeto está congelado para evitar mutaciones en runtime.
 * HITO 1: Añadida sección LOGGING para Single-Batch Flush a VFS.
 * ==============================================================================
 */

function _deepFreeze_(value) {
  Object.getOwnPropertyNames(value).forEach(key => {
    if (value[key] && typeof value[key] === 'object' && !Object.isFrozen(value[key])) _deepFreeze_(value[key]);
  });
  return Object.freeze(value);
}

const BIOOS_CONFIG = _deepFreeze_({
  VERSION: "8.7.1",
  RELEASE_CHANNEL: "production",

  // Capabilities are source-controlled and fail closed. Enabling one may also
  // require adding its OAuth scope back to appsscript.json and redeploying.
  CAPABILITIES: {
    WORKSPACE_CONTEXT: false,
    EXTERNAL_TASKS: false,
    VOICE_INPUT: true
  },

  // ----------------------------------------------------------------------------
  // [1] SYSTEM FLAGS (Banderas SRE y Mantenimiento)
  // ----------------------------------------------------------------------------
  SYS_FLAGS: {
    DEBUG_MODE: true,             // Habilita trazabilidad HIL y Provenancia
    MAINTENANCE_MODE: false,      // Bloqueo 503 a nivel de Webhook
    GRACEFUL_DEGRADATION: true,   // Permite aborto cognitivo salvaguardando L0
    ENABLE_AUTO_REPAIR: true      // Habilita RCA de solo lectura; nunca muta ROM automáticamente
  },

  // ----------------------------------------------------------------------------
  // [2] WATCHDOG & MUTEX (Control Estricto de Concurrencia V8)
  // ----------------------------------------------------------------------------
  TIMING: {
    WATCHDOG_MAX_EXECUTION_MS: 240000,  // Aborto preventivo a los 4 mins (Límite GAS: 6 mins)
    MUTEX_LOCK_TIMEOUT_MS: 5000,        // Timeout para LockService
    TIMEZONE: "America/Costa_Rica"      // Ancla cronobiológica de sincronización
  },

  // ----------------------------------------------------------------------------
  // [3] RESILIENCE ENGINE (Lógica de Recuperación)
  // ----------------------------------------------------------------------------
  RESILIENCE: {
    MAX_RETRIES: 3,
    BACKOFF_BASE_MS: 2000,
    CIRCUIT_BREAKER_TRIP: 5
  },

  // ----------------------------------------------------------------------------
  // [4] HIERARCHICAL MEMORY & RATE-DISTORTION (Gestión de Contexto)
  // ----------------------------------------------------------------------------
  MEMORY_LIMITS: {
    PROPERTIES_MAX_BYTES: 9216,         // Límite físico de PropertiesService (Caché L1)
    SHEET_CELL_MAX_CHARS: 50000,        // Límite físico por celda en Sheets (L0)

    // Umbrales de Ansiedad de Contexto (Rate-Distortion)
    COMPACTION_THRESHOLD_PCT: 0.75,     // Dispara el GC preventivo al 75% de la ventana
    MAX_ACTIVE_CONDITIONS: 10,          // Límite de eventos antes de forzar consolidación L3

    // Arquitectura de 5 niveles
    LEVELS: {
      L0_INGESTION: "Cola transaccional de entrada",
      L1_WORKING: "Búfer de turno conversacional",
      L2_EPISODIC: "Eventos semanales en NVRAM",
      L3_SEMANTIC: "Grafo de conocimiento médico base",
      L4_BASAL: "Ajuste longitudinal del Gemelo Digital"
    }
  },

  // ----------------------------------------------------------------------------
  // [5] SRE LOGGING (HITO 1 — Single-Batch Flush)
  // ----------------------------------------------------------------------------
  LOGGING: {
    TELEMETRY_SHEET: "L1_Telemetry_Log",
    FLUSH_TIMEOUT_MS: 3000,             // Tiempo máximo para intentar el volcado atómico
    MAX_BUFFER_SIZE: 200                // Protección contra desbordamiento de RAM V8
  },

  // ----------------------------------------------------------------------------
  // [6] BIOMETRIC BASELINES (Anclas Evolutivas)
  // ----------------------------------------------------------------------------
  BIOMETRY: {
    TARGET_STEPS: 8000,
    TARGET_SLEEP_HRS: 7.0,
    BASELINE_RHR: 43
  },

  // ----------------------------------------------------------------------------
  // [7] CLUSTER TOPOLOGY (Federación de Agentes v5.0)
  // ----------------------------------------------------------------------------
  AGENTS: {
    FRONTEND: [
      "orquestador",        // Interfaz de usuario, enrutamiento y despacho final
      "compilador_bio"      // Alineación ortogonal MOMA: ruido -> tokens sintéticos
    ],
    SPECIALISTS: [
      "somnologo",          // Arquitectura de sueño (SNC)
      "fisiologo",          // Carga física y biomecánica
      "endocrinologo",      // Triangulación nutricional y HRV
      "psicologo_cog"       // Carga alostática y fatiga central
    ],
    BACKEND: [
      "auditor",            // Protocolo SPADE (Revisión por Pares y Concesión)
      "sre_agent",          // Análisis topológico de causa raíz (AgentDebugX)
      "meta_reasoner"       // Evolución de prompts (AutoResearch)
    ]
  },

  // ----------------------------------------------------------------------------
  // [8] HIL TELEMETRY DICTIONARY (Trazabilidad y Provenancia)
  // ----------------------------------------------------------------------------
  TELEMETRY: {
    ACK:       "📡 [SYS_ACK] -",
    PROCESS:   "⚙️ [SYS_PROCESS] -",
    SUCCESS:   "✅ [SYS_OK] -",
    WARNING:   "⚠️ [SYS_WARN] -",
    ERROR:     "🚨 [SYS_FAULT] -",
    FATAL:     "💀 [SYS_PANIC] -",
    GC:        "🧹 [SYS_GC] -",
    SRE:       "🛠️ [SYS_SRE] -",
    WATCHDOG:  "⏱️ [WATCHDOG] -"
  }
});

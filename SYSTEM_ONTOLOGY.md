# 🧬 SYSTEM_ONTOLOGY.md — BIOOS CORE
## Ontología de Componentes, Topología de Directorios y Contratos de Datos

> **BioOS Core** opera bajo una ontología rigurosa donde cada archivo, estructura de memoria y contrato de datos tiene un límite de responsabilidad bien definido.

---

## 1. Topología del Árbol de Directorios

```text
BioOS_Core/
│
├── .clasp.json                           # Configuración de clasp y Script ID de Google Apps Script
├── .claspignore                          # Reglas de exclusión de sincronización hacia GAS
├── .editorconfig                         # Estándares de codificación e indentación
├── .gitignore                            # Exclusiones de Git (seguridad y datos sensibles)
│
├── BioOS_ROM.json                        # Memoria de Solo Lectura: Reglas inmutables y prompts maestros
├── BioOS_NVRAM.json                      # Memoria No Volátil Primaria (Esquema L0-L4)
├── BioOS_NVRAM.slotA.json                # Slot A de recuperación atómica NVRAM
├── BioOS_NVRAM.slotB.json                # Slot B de recuperación atómica NVRAM
│
├── ARCHITECTURE_MANIFEST.md              # Manifiesto y Estado del Arte del Exocórtex
├── AGENT_ROSTER.md                       # Nómina oficial de agentes, prompts y esquemas JSON
├── SYSTEM_ONTOLOGY.md                    # Topología, índices y contratos de datos (Este documento)
├── FLOW_DIAGRAMS.md                      # Diagramas de flujo arquitectónicos en Mermaid.js
├── DEVELOPMENT_BACKLOG.md                # Backlog técnico priorizado para evolución autónoma
├── README.md                             # Guía rápida del repositorio y comandos CLI
├── CHANGELOG.md                          # Registro cronológico de versiones y parches SRE
│
├── apps-script/                          # CÓDIGO FUENTE CANÓNICO (Google Apps Script V8)
│   ├── appsscript.json                   # Manifiesto GAS, zona horaria y OAuth Scopes
│   ├── 00_Sys_Config.js                  # ROM congelada del kernel, flags SRE y constantes
│   ├── 01_Sys_Telemetry.js               # Watchdog, Buffer de telemetría SRE y Egress Telegram
│   ├── 01b_LLM_Gateway.js                # Pasarela Gemini 3.x, cuotas y rotación por failover
│   ├── 02_Mem_Hierarchical.js            # VFS en Google Drive, NVRAM L0-L4 y mutaciones ACID
│   ├── 02b_DB_Repository.js              # Repositorio L0 en Google Sheets (Queue_NLP) y Leases
│   ├── 03_Mem_GC.js                      # Compactor L1->L2 por Rate-Distortion y Minería L2->L3
│   ├── 03b_Net_Webhook.js                # Ingesta multimodal (audio/foto/texto) y Web App endpoints
│   ├── 04_Sensor_Engine.js               # Orquestador del motor de sensores biométricos
│   ├── 05_Bio_Compiler.js                # Compilador MOMA (visión, notas de voz, NLP) y SRC
│   ├── 06_Agent_Orchestrator.js          # Orquestador central, Cooldown L1 y CoT Clínico
│   ├── 07_Agent_Specialists.js           # Registro declarativo de agentes especialistas
│   ├── 08_Agent_Auditor.js               # Auditor SPADE (puerta de seguridad determinista)
│   ├── 09_SRE_DeepDebug.js               # Agente SRE, análisis RCA y hot-swap read-only
│   ├── 10_Meta_Evolve.js                 # Auditoría semanal ACWR y meta-evolución mensual
│   ├── 11_Net_Daemons.js                 # Workers asíncronos y triggers cronobiológicos
│   ├── 12_Workspace_Integration.js       # Integración con Google Tasks, Calendar y Gmail
│   ├── 99_System_Boot.js                 # Secuencia de arranque no mutante y preflight
│   ├── QA_Test_Suite.js                  # Guardián de seguridad contra ejecución en producción
│   ├── QA12_Deep_Validation.js           # Suite nativa de validación profunda (7 pruebas de estrés)
│   ├── QA_Production_Suite.js            # Suite de resiliencia SRE extrema (8 pruebas de producción)
│   ├── QA_Empirical_Tests.js             # Pruebas empíricas (Google Fit empty points, audio panic, CoT)
│   │
│   ├── core/                             # CONTRATOS BASE Y UTILIDADES PURAS
│   │   ├── 00_Core_Contracts.js          # Typedefs y constantes de operaciones
│   │   ├── 01_Core_Result.js             # Envelope Result (Core_ok / Core_err / Core_try)
│   │   ├── 02_Core_Errors.js             # Normalización y clasificación de errores
│   │   ├── 03_Core_RequestContext.js     # Contexto de correlación y presupuestos de tiempo
│   │   └── 04_Core_StructuredJson.js     # Parser robusto de JSON estructurado con balanceo
│   │
│   ├── agents/                           # CONTRATOS COGNITIVOS Y POLÍTICAS
│   │   ├── 00_Cognitive_Contracts.js     # Tipos y validadores de Hipótesis, Decisión y Resultado
│   │   └── 01_Decision_Policy.js         # Política determinista de decisión (ACT/ASK/DEFER/ESCALATE)
│   │
│   ├── sensors/                          # PROVEEDORES DE SENSORES
│   │   ├── 00_Sensor_Contracts.js        # Tipos Sensor_Snapshot y normalización
│   │   ├── 01_Mobvoi_Provider.js         # Proveedor primario Mobvoi TicWatch REST API
│   │   └── 02_GoogleFit_Provider.js      # Proveedor de contingencia Google Fit REST API
│   │
│   ├── memory/                           # LIBROS MAYORES DE RESULTADOS
│   │   └── 01_Outcome_Ledger.js          # Ledger inmutable de outcomes para Active Inference
│   │
│   ├── ops/                              # OPERACIONES Y DIAGNÓSTICO
│   │   ├── 01_Health_Check.js            # Health check y preflight de solo lectura
│   │   ├── 02_Runtime_Maintenance.js     # Mantenimiento protegido por token (migraciones, purgas)
│   │   └── 03_Diagnostics_Suite.js       # Suite de diagnóstico remoto de latencia y VFS
│   │
│   └── qa/                               # SUITE DE PRUEBAS UNITARIAS AISLADAS (Node.js & GAS)
│       ├── 00_Isolated_Fakes.js          # Fakes en memoria para servicios de Apps Script
│       ├── 01_Isolated_Suite.js          # Runner aislado para el entorno de Apps Script
│       ├── 02_memory_store.node.test.js  # Tests de memoria jerárquica
│       ├── 03_job_flow.node.test.js      # Tests de ciclo de cola L0
│       ├── 04_outcome_ledger.node.test.js# Tests del outcome ledger
│       ├── 05_multimodal_batch.node.test.js # Tests de ingesta multimodal
│       ├── 06_orchestrator_cognition.node.test.js # Tests de cognición y cooldown
│       ├── 07_deep_validation.node.test.js # Tests de validación profunda
│       ├── 08_sre_production_resilience.node.test.js # Tests de resiliencia SRE
│       ├── 09_production_suite.node.test.js # Tests de producción real
│       └── 10_empirical_suite.node.test.js # Tests empíricos de CoT y sensores
│
├── scripts/                              # HERRAMIENTAS CLI Y AUTOMATIZACIÓN LOCAL
│   ├── validate.mjs                      # Verificador estático de sintaxis y duplicados
│   ├── audit-state.mjs                   # Auditoría de estado y dependencias
│   ├── deploy-gas.mjs                    # Pipeline de despliegue a producción vía Apps Script API
│   ├── run-clasp.mjs                     # Wrapper de clasp con credenciales OAuth
│   └── black-box-test.mjs                # Pruebas de caja negra contra Web App
│
├── docs/                                 # DOCUMENTACIÓN COMPLEMENTARIA
│   ├── ARCHITECTURE.md                   # Resumen arquitectónico rápido
│   ├── DATA_LAYOUT.md                    # Disposición de datos en Google Drive
│   ├── OPERATIONS.md                     # Manual operativo de despliegues y rollbacks
│   └── ROADMAP.md                        # Historial y estado de hitos
│
└── package.json                          # Manifiesto de npm, dependencias y scripts de prueba
```

---

## 2. Ontología de Memoria Jerárquica (L0 -> L4)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ESTRATOS DE MEMORIA DEL EXOCÓRTEX                        │
├──────┬───────────────────────┬──────────────────────────────────────────────┤
│ L0   │ Ingestion Cursors     │ Persistido en `BioOS_Database.gsheet`        │
│      │ (Transaccional)       │ Tabla `Queue_NLP` con bloqueo ScriptLock     │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ L1   │ Working Memory        │ Búfer volátil de turno + `session_events`    │
│      │ (Corto Plazo / <24h)  │ Dispara alerta de ansiedad al 75% capacidad  │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ L2   │ Episodic Memory       │ `weekly_archives` (resúmenes comprimidos)    │
│      │ (Medio Plazo / Semanal│ `raw_data_lake` podado a <150 KB             │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ L3   │ Semantic Graph        │ `medical_knowledge_graph` (lesiones activas) │
│      │ (Largo Plazo)         │ `evolutionary_weights` (pesos bayesianos)    │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│ L4   │ Basal Digital Twin    │ Parámetros fisiológicos nominales            │
│      │ (Invariante Físico)   │ RHR: 43 bpm | Pasos: 8000 | Sueño: 7.3h      │
└──────┴───────────────────────┴──────────────────────────────────────────────┘
```

---

## 3. Matriz de Script Properties (Variables de Entorno)

| Propiedad / Variable | Tipo | Sensibilidad | Propósito Operativo |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | String | 🔒 Alta | Acceso a modelos Gemini 3.6 Flash / Flash Lite en Google AI Studio. |
| `TELEGRAM_BOT_TOKEN` | String | 🔒 Alta | Token del bot de Telegram (`@B80324_BioOS_bot`). |
| `TELEGRAM_CHAT_ID` | String | 🔒 Media | ID del chat del usuario autorizado (Zero-Trust filter). |
| `TELEGRAM_SECRET_TOKEN` | String | 🔒 Alta | Cabecera secreta de verificación de webhook de Telegram. |
| `BIOOS_WEB_APP_URL` | String | 🌐 Baja | URL HTTPS del proxy de Cloudflare Workers (`workers.dev`). |
| `BIOOS_DB_ID` | String | 📁 Baja | ID de la hoja de cálculo Google Sheets (`BioOS_Database`). |
| `BIOOS_OPS_APPROVAL_TOKEN`| String | 🔒 Alta | Token de 24+ caracteres para autorizar migraciones o purgas. |
| `VFS_FOLDER_ID` | String | 📁 Baja | ID de la carpeta `BioOS_Core` en Google Drive. |
| `VFS_ROM_ID` | String | 📁 Baja | ID del archivo `BioOS_ROM.json`. |
| `VFS_NVRAM_ID` | String | 📁 Baja | ID del archivo `BioOS_NVRAM.json`. |
| `MOBVOI_API_ENDPOINT` | String | 🌐 Media | Endpoint HTTPS para telemetría de TicWatch. |
| `MOBVOI_API_TOKEN` | String | 🔒 Alta | Token Bearer para autenticación en Mobvoi API. |

---

## 4. Contratos de Datos Canónicos (Core Typings)

### 4.1. Core_Result (`apps-script/core/01_Core_Result.js`)
```javascript
// Operación Exitosa
{ ok: true, value: Object|Array|string|number, meta: Object }

// Operación Fallida
{ ok: false, error: Core_ErrorInfo, meta: Object }
```

### 4.2. Core_ErrorInfo (`apps-script/core/02_Core_Errors.js`)
```javascript
{
  code: string,         // e.g. "CORE_TRANSIENT_DEPENDENCY", "VALIDATION_ERROR"
  category: string,     // "DEPENDENCY" | "VALIDATION" | "SECURITY" | "CONCURRENCY" | "CORE"
  message: string,      // Mensaje técnico seguro sin exponer secretos
  retryable: boolean,   // Determina si puede reintentarse con el mismo idempotencyKey
  details: Object,      // Metadatos adicionales de depuración
  causeName: string     // Nombre de la excepción de origen
}
```

### 4.3. Sensor_Snapshot (`apps-script/sensors/00_Sensor_Contracts.js`)
```javascript
{
  source: string,       // "mobvoi" | "google_fit" | "none"
  available: boolean,   // True si al menos un sensor retornó datos válidos
  fetchedAt: string,    // ISO-8601 timestamp
  sinceMs: number,      // Ventana de consulta (ms)
  data: {
    rhrBpm: number|null,
    sleepMinutes: number|null,
    steps: number|null,
    distanceKm: number|null,
    distanceMeters: number|null,
    caloriesKcal: number|null
  },
  missing: { rhrBpm: boolean, sleepMinutes: boolean, steps: boolean },
  degraded: boolean,
  reason: string|null,
  metadata: Object
}
```

---

## 5. Grafo de Dependencias Globales de Google Apps Script

En el runtime de Google Apps Script (V8), todos los archivos comparten un ámbito léxico global. La jerarquía de inicialización e invocación es estrictamente unidireccional para prevenir dependencias circulares:

```text
[00_Sys_Config]
       │
       ▼
[00_Core_Contracts & Result & Errors & RequestContext]
       │
       ├───────────────────────────────────────────────────────┐
       ▼                                                       ▼
[01_Sys_Telemetry & Egress]                             [02_Mem_Hierarchical & VFS]
       │                                                       │
       ├─────────────────────────┬─────────────────────────────┤
       ▼                         ▼                             ▼
[01b_LLM_Gateway]        [02b_DB_Repository]           [04_Sensor_Engine]
       │                         │                             │
       ▼                         ▼                             ▼
[05_Bio_Compiler]        [03b_Net_Webhook]             [sensors/* Providers]
       │                         │
       └────────────┬────────────┘
                    ▼
       [07_Agent_Specialists & 08_Agent_Auditor (SPADE)]
                    │
                    ▼
       [06_Agent_Orchestrator (Active Inference & CoT)]
                    │
                    ├──────────────────────────────────────────┐
                    ▼                                          ▼
       [11_Net_Daemons (Cron & Workers)]            [10_Meta_Evolve & 12_Workspace]
                    │
                    ▼
       [99_System_Boot & Ops Suite]
```

# 📋 DEVELOPMENT_BACKLOG.md — BIOOS CORE
## Backlog Técnico Estructurado, Deuda Técnica Priorizada y Vectores de Evolución Autónoma

> **BioOS Core v8.5** cuenta con un roadmap estructurado por épicas y prioridades para su desarrollo incremental, garantizando que futuras expansiones mantengan la rigurosidad SRE y los invariantes de seguridad.

---

## 1. Matriz de Priorización de Épicas

| Épica | Nombre de la Épica | Prioridad | Estado | Impacto Arquitectónico |
| :--- | :--- | :--- | :--- | :--- |
| **EPIC-01** | **Ingesta Multimodal & Desacoplamiento L0** | P0 (Crítica) | ✅ Completado | Ingesta de notas de voz, fotos y texto con cola durable en Sheets. |
| **EPIC-02** | **Resiliencia SRE & Egress Blindado** | P0 (Crítica) | ✅ Completado | Sanitización HTML Telegram, Dead-Letter Protocol y Watchdog. |
| **EPIC-03** | **Inferencia Activa, Cooldown L1 & CoT Clínico**| P0 (Crítica) | ✅ Completado | Deducción médica paso a paso, anclaje L1 y veto anti-alucinación. |
| **EPIC-04** | **Observabilidad Viva & Dashboard de Métricas** | P1 (Alta) | 🔄 En Progreso | Comandos `/estado`, `/doctor` y métricas continuas de sensores. |
| **EPIC-05** | **Outcome Ledger & Active Inference Loop** | P1 (Alta) | 📅 Planificado | Cierre del bucle de aprendizaje: Decisión $\rightarrow$ Acción $\rightarrow$ Outcome. |
| **EPIC-06** | **Integración de Sensores BLE Directos / Webhook Edge**| P2 (Media) | 📅 Planificado | Ingesta en tiempo real desde pulsómetros y bandas pectorales (HRV). |
| **EPIC-07** | **Optimización de Cuotas LLM & Caching Semántico** | P2 (Media) | 📅 Planificado | Caché semántica en ScriptCache para preguntas recurrentes. |

---

## 2. Historias de Usuario Técnicas y Tareas por Prioridad

---

### 🔴 P0 — Estabilidad de Producción y Gobernanza (Completado)

#### [P0-1] Tubería Biometría & Extracción Numérica Exacta
* **Descripción**: Erradicar colapsos por `point: []` en Google Fit y asegurar que el Orquestador preserve números exactos de RHR, pasos, sueño y distancia.
* **Criterios de Aceptación**:
  - `_pickNumericValue_` maneja tanto números directos como cadenas formateadas sin TypeErrors.
  - Tests unitarios en `qa/10_empirical_suite.node.test.js` pasando al 100%.

#### [P0-2] Sanitización HTML y Dead-Letter Protocol
* **Descripción**: Blindar `_rawSystemNotify` con balanceador de tags HTML, reintentos con backoff y alerta de pánico `_dispatchDeadLetterPanic_` ante fallo definitivo.
* **Criterios de Aceptación**:
  - Mensajes con operadores `<` y `>` en bloques de código escapan entidades correctamente.
  - Fallback a texto plano activado de inmediato ante HTTP 400.

---

### 🟡 P1 — Observabilidad, Outcome Loop y Recuperación Histórica (En Curso)

#### [P1-1] Integración Completa del Outcome Ledger con NVRAM L3
* **Objetivo**: Conectar el módulo `memory/01_Outcome_Ledger.js` con las decisiones tomadas por el Orquestador para registrar la efectividad de las prescripciones de running y nutrición.
* **Tareas Técnicas**:
  1. Invocar `Memory_appendOutcomeLedger` al finalizar cada sesión de running confirmada.
  2. Almacenar deltas de rendimiento (ritmo real vs prescrito, percepción de fatiga).
  3. Cruzar con `evolutionary_weights` en el ciclo mensual de Meta-Evolución.
* **Criterio de Aceptación**: NVRAM L3 contiene un historial auditable de hasta 200 outcomes con utilidad calculada $[-1.0, 1.0]$.

#### [P1-2] ETL Seguro para Respaldos Históricos de Health Connect
* **Objetivo**: Diseñar una herramienta de importación por lotes para el archivo `Health Connect.zip` (74 MB) sin desbordar los límites de memoria de Google Apps Script.
* **Tareas Técnicas**:
  1. Crear un script Node.js local (`scripts/import-health-connect.mjs`) que procese los CSV/JSON locales.
  2. Calcular métricas basales agregadas (promedio mensual de RHR, volumen semanal de carrera).
  3. Inyectar únicamente los resúmenes compactados en `L3_Semantic.medical_knowledge_graph`.
* **Criterio de Aceptación**: Memoria NVRAM incrementa en menos de 20 KB tras procesar años de historial.

---

### 🟢 P2 — Expansión Funcional & Optimizaciones Avanzadas (Futuro)

#### [P2-1] Caché Semántico en Memoria Volátil (ScriptCache)
* **Objetivo**: Reducir consumo de llamadas Gemini para consultas repetitivas de estado o consultas de comandos rápidos.
* **Tareas Técnicas**:
  1. Hash SHA-256 del input de usuario + contexto L1.
  2. Búsqueda en `CacheService.getScriptCache()` con TTL de 600 segundos.
  3. Bypass de invocación LLM si el contexto no ha variado.
* **Criterio de Aceptación**: Reducción del 30% en llamadas al Gateway durante sesiones interactivas.

#### [P2-2] Conexión Directa con Dispositivos Garmin / Polar vía Webhook Edge
* **Objetivo**: Añadir soporte para proveedores adicionales de hardware mediante webhooks en Cloudflare Workers.
* **Tareas Técnicas**:
  1. Extender `apps-script/sensors/` con `03_Garmin_Provider.js`.
  2. Implementar adaptador `Sensor_Snapshot` normalizado.
* **Criterio de Aceptación**: Coexistencia armónica con Mobvoi y Google Fit sin mutaciones en el Orquestador.

---

## 3. Registro de Deuda Técnica y Mitigaciones SRE

| Código | Descripción de la Deuda | Severidad | Mitigación Implementada / Planificada |
| :--- | :--- | :--- | :--- |
| **DT-01** | Límite de ejecución de 6 minutos en Google Apps Script | Media | Watchdog global a los 4.3 minutos (`_CRITICAL_TIME_LIMIT`) con aborto preventivo y volcado de telemetría. |
| **DT-02** | Consistencia eventual en Google Drive (latencia al buscar archivos recién creados) | Media | Fast Cache L1 en `ScriptCache` (<2ms) + polling con backoff exponencial y jitter en `_repoResolveOffloadedPayload_`. |
| **DT-03** | Cuota diaria de peticiones en Gemini Free Tier (200 req/día) | Baja | Circuit Breaker `_checkAndConsumeDailyQuota()` en `01b_LLM_Gateway.js` con bloqueo fail-closed para evitar facturación imprevista. |
| **DT-04** | Límite físico de celdas en Google Sheets (50,000 caracteres) | Baja | `_repoOffloadLargePayloadToDrive_`: Si el payload excede el 80% de la celda, se traslada automáticamente a un archivo temporal en Drive. |

---

## 4. Guía para la Evolución Autónoma del Repositorio

Para que agentes autónomos continúen desarrollando este repositorio sin intervención humana:
1. **Ejecutar siempre `npm run verify`** antes y después de cualquier cambio en el código.
2. **Respetar la unicidad de nombres globales**: En GAS V8, ninguna función puede tener nombres duplicados entre archivos.
3. **No romper la inmutabilidad de ROM**: Las modificaciones a prompts deben realizarse mediante propuestas en `BioOS_ROM_Review_Audit` o edición manual documentada en CHANGELOG.
4. **Documentar cada versión en CHANGELOG.md**: Siguiendo el estándar semántico de Keep a Changelog.

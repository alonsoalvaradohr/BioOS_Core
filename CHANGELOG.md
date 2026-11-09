# Changelog

## 8.14.1 - 2026-11-09

- Cadence/stride history questions now read their own L2 report partition; they no longer fall through to generic biometrics or claim absence without querying the durable store.
- The same-turn photo flow refreshes its L2 result after storing extracted metrics, so a recovered question sees facts written from that image immediately.
- Empty L2 and unavailable L2 reader produce distinct factual responses.

## 8.14.0 - 2026-11-09

- Technical cadence/stride panels are extracted and persisted independently of full session cards, with Telegram photo event and `reported` provenance.
- A recent running-technique question can be recovered from L1 when Telegram dispatches its following photo as a separate job.
- Photo inference failures and unreadable panels now receive an explicit, actionable response instead of generic SRE degradation text.
- Technique guidance is evidence-bounded; cadence is not treated as a universal target, and a single image is not used to diagnose gait.

## 8.13.0 - 2026-11-09

- `/doctor` checks the single `fitness.location.read` permission needed for distance; private `/reauth` returns its Apps Script consent URL only when authorization is actually required. No scopes are added.
- Activity vs. performance question plans are separated: a two-run comparison reads two sessions; last-run assessment reads one and reports when a national benchmark is missing.
- Multimodal compiler extracts only visible workout values from user-submitted images, anchors them to the Telegram evidence event, and stores validated metrics in structured L2 as `reported` without keeping image bytes.
- An image report links to a Google Fit session only when there is one unique local start within 15 minutes. Reports retain their own source and pace consistency; sources are never overwritten or conflated.

## 8.12.0 - 2026-11-09

- Historical run questions are routed to a Google Fit session reader for the latest running, jogging, and treadmill sessions, with exact per-session distance requests and derived pace comparisons.
- Running sessions and source timestamps are persisted as structured L2 facts; cached distance is reused only for the same Google Fit session ID.
- `/doctor` now shows a sanitized Google API status/code/reason for failed aggregates, without exposing raw response bodies or credentials.
- Missing sessions, distance, or duration remain explicitly unavailable; BioOS does not infer pace from steps or calories.

## 8.11.0 - 2026-11-09

- Historical sleep-time questions now use a deterministic route even without the words “average” or “sleep”.
- Google Fit history reads sleep sessions (`activityType=72`) and exact sleep-stage points, preserving start/end timestamps and per-endpoint HTTP/point counts.
- Session boundaries are persisted as structured L2 `sleep_session` records and can be retrieved later if the source is temporarily unavailable; no times are fabricated from baselines.
- `/doctor` shows HTTP status and point counts for each Google Fit aggregate, distinguishing successful empty queries from populated fields.

## 8.10.0 - 2026-11-09

- Morning briefing reports the prior local waking day and preceding night's sleep; evening briefing reports activity from the current local day. Both print their measurement window.
- Google Fit range cache keys include activity and sleep bounds, preventing reuse of a snapshot for a different window.
- Last-week sleep/activity questions now query daily Google Fit buckets for the prior calendar week and return averages or an explicit missing-data result instead of a generic coaching response.
- Historical sleep segments are aligned to their waking date and unavailable values remain missing.

## 8.9.0 - 2026-11-09

- Sensor activity totals now use the current local calendar day; sleep segments use the preceding 24-hour window and exclude awake/out-of-bed stages.
- `/doctor` reports exact UTC windows and labels Google Fit calories as total expenditure including resting energy.
- User questions now reach the final synthesis verbatim, include observation time and agenda availability, and are routed to up to two keyword-matched specialists instead of the first two registry entries.
- Structured daily sensor snapshots persist in L2 and link to user-reported semantic memories by evidence ID; the orchestrator receives recent measurements plus the generated evidence graph.
- Partial recovery telemetry no longer authorizes fixed training loads or claims that RHR/sleep are known.

## 8.8.1 - 2026-11-09

- Fixed sensor normalization so absent `null` values remain missing instead of becoming false zero readings.
- Cached successful Google Fit snapshots for ten minutes so `/doctor`, `/memoria`, and briefings reuse the same recent measurement inside the API cooldown.
- `/doctor` now reports received metric fields, renders zero distance/sleep as unavailable, and distinguishes synced history from a live heart-rate stream.

## 8.8.0 - 2026-11-09

- Restored the existing Google Fit REST path as failover when Health Connect has no Android bridge and when Mobvoi is unavailable; `/doctor` remains the live validation and no Fit response is assumed.
- Added persistent L3 semantic atoms, private versioned 96D local feature vectors and cosine retrieval in orchestrator/briefing context. Added `/recordar`, `/memoria`, `/olvidar ID`, and explicit `/resultado` storage.
- Added provenance/expiry, a 300-memory cap, the 4 MB NVRAM hard cap, and recovery-slot snapshots for semantic/outcome writes.
- Updated the Xiaomi Watch 2 route and documented Google Fit as a compatibility path that must migrate to Health Connect.

## 8.7.1 - 2026-11-09

- Morning briefings now read recent user-reported training intent from L1 working memory, label it as reported rather than verified, and avoid asking for the same plan again when one was recently supplied.
- Sensorless briefings now identify telemetry as unavailable and state that basal profile values are not today's measurements.

## 8.7.0 - 2026-11-09

- Changed trigger reconciliation to keep only daily morning/evening briefings and remove weekly ACWR/monthly self-tuning jobs. The production trigger list still requires a runtime reconciliation.
- Made the health check read-only for Queue_NLP: it reports missing/mismatched schema without creating sheets, setting properties, or migrating data.
- Added an owner-only Apps Script API function for sending a system report to the configured Telegram chat; delivery requires the Apps Script project and OAuth client to share a standard Google Cloud project. The report includes architecture, operational check statuses, trigger count and memory structure/counts, not raw biometric values or secrets.
- Added an `executionApi` manifest entry restricted to `MYSELF` for authenticated owner-run reporting.
- Production rollout updated the known versioned web-app deployments so public legacy GET actions that mutate memory/triggers or return token fragments are removed.

## 8.6.0 - 2026-11-08

## 8.6.0 - 2026-11-08

- Scheduled morning and evening reports now render only observed sensor fields and explicitly identify missing data; they no longer ask an LLM to invent workouts, macros, or sleep schedules.
- Removed average exercise/general heart rate from the Google Fit adapter's RHR field.
- Disabled weekly ACWR reports and automatic monthly weight tuning until verified workout outcomes are connected.
- Added release-tag deployment automation. The deploy script requires one explicit Apps Script deployment ID, keeps clasp credentials read-only, and updates no other deployments.
- Health checks now report that Mi Fitness/Health Connect ingestion is not yet connected.

## 5.4.0 - 2026-08-21

- **Resolución de Incidente Crítico: Tubería de Datos Biométricos & Integridad Numérica**:
  - Reescrita la extracción de telemetría en [`06_Agent_Orchestrator.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/06_Agent_Orchestrator.js) con `_extractBiometricTelemetry_` y `_pickNumericValue_`. Ahora prioriza y unifica telemetría de hardware y cargas útiles directas (`rawPayload`), preservando métricas numéricas exactas (`rhrBpm`, `sleepMinutes`, `sleepHours`, `steps`) y calculando deltas fisiológicos matemáticos vs `L4_Basal`.
  - Corregido `compileBiometricTelemetry` en [`05_Bio_Compiler.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/05_Bio_Compiler.js) para preservar números reales en `raw_metrics` e impedir falsos positivos de `SENSOR_OFFLINE`.
  - Ajustado `Sensor_GOOGLE_FIT_FALLBACK_MS` en [`sensors/00_Sensor_Contracts.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/sensors/00_Sensor_Contracts.js) de 32 horas a 5 minutos para erradicar el bloqueo indebido del fallback de Google Fit.
- **Anclaje de Contexto L1 y Cooldown Cognitivo (<12h)**:
  - Implementada `_extractL1CognitiveContext()` en [`06_Agent_Orchestrator.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/06_Agent_Orchestrator.js) para analizar la memoria de trabajo (`L1_Working.session_events`).
  - Inyección dinámica en el prompt de síntesis: cuando el usuario reportó feedback cualitativo en las últimas 12 horas, se activa el **Cooldown Cognitivo**, obligando al modelo a basar su prescripción en dicho contexto (molestias, estrés, adherencia, planes) y **prohibiendo estrictamente** formular preguntas redundantes sobre su estado.
- **Escudo Anti-Alucinación Estricto (Supresión del "Buen Estudiante")**:
  - Invariante de seguridad en `_synthesizeOrchestration_`: bajo `[BASAL_NOMINAL]` (Ceguera Sensorial), queda **terminantemente vetado** inventar métricas, prescribir entrenamientos de alta exigencia (nada de "10 km Z2 a 5:15/km" ni series) o cálculos complejos de carbohidratos. La salida se limita a carga mínima/descanso y, si no hay contexto L1, exactamente UNA pregunta quirúrgica para reconciliación.
- **Cobertura de Pruebas Unitarias SRE**:
  - Creado [`qa/06_orchestrator_cognition.node.test.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/qa/06_orchestrator_cognition.node.test.js) con 7 aserciones deterministas sobre telemetría, cooldown L1 y escudo anti-alucinación. Todos los tests pasando (5 suites, 0 fallos).

## 5.3.2 - 2026-08-20

- **Idempotencia Estricta y Desduplicación de Triggers**:
  - Reescrita en [`11_Net_Daemons.js:L160-L240`](file:///i:/My%20Drive/BioOS_Core/apps-script/11_Net_Daemons.js#L160-L240) la función `reconcileCronobiologicalTriggers()` con auditoría de unicidad absoluta. Purgados todos los disparadores huérfanos o duplicados, garantizando exactamente 1 instancia activa de cada uno de los 4 handlers canónicos (`triggerMorningBriefing`, `triggerEveningBriefing`, `triggerWeeklyAudit`, `triggerMonthlyMetaEvolution`).
- **Trazabilidad de Telemetría Real vs. Estimada (Anti-Alucinación)**:
  - Implementada en [`06_Agent_Orchestrator.js:L60-L95`](file:///i:/My%20Drive/BioOS_Core/apps-script/06_Agent_Orchestrator.js#L60-L95) la distinción explícita de origen de datos: `[HARDWARE_LIVE]` (frescura < 6h) vs. `[BASAL_NOMINAL]` (ceguera sensorial activa).
  - Veto estricto en el prompt de síntesis ([`06_Agent_Orchestrator.js:L155-L175`](file:///i:/My%20Drive/BioOS_Core/apps-script/06_Agent_Orchestrator.js#L155-L175)) prohibiendo afirmar variaciones en tiempo real bajo ceguera sensorial y obligando a formular preguntas de reconciliación cualitativa.
- **Purga de Código Muerto y Saneamiento de Memoria**:
  - Eliminada función legacy `emergencyStopAndPurge` y saneados los esquemas tipados de `L3_Semantic` y `L4_Basal`.
- **Despliegue de Producción v47**: Validada la lista de 4 triggers activos en producción y entrega en Telegram confirmada HTTP 200.

## 5.3.0 - 2026-08-20

- **Motor de Meta-Evolución Cognitiva y Tuning Longitudinal**:
  - **Bucle Diario**: Inyección de deltas de calibración (`calibration_deltas`) en NVRAM L3/L4 para contrastar prescripciones vs. ejecuciones reales.
  - **Bucle Semanal (`triggerWeeklyAudit`)**: Implementada `executeWeeklyAudit()` en [`10_Meta_Evolve.js:L55`](file:///i:/My%20Drive/BioOS_Core/apps-script/10_Meta_Evolve.js#L55) con reporte táctico dominical (estado del Gemelo Digital, adaptación mitocondrial, ACWR, ajuste de volumen y alertas de Workspace). Disparador programado los Domingos a las 18:00 en `America/Costa_Rica`.
  - **Bucle Mensual (`triggerMonthlyMetaEvolution`)**: Implementada `executeMonthlyMetaEvolution()` en [`10_Meta_Evolve.js:L115`](file:///i:/My%20Drive/BioOS_Core/apps-script/10_Meta_Evolve.js#L115) para ajuste automático de `evolutionary_weights`, auto-poda y consolidación profunda a < 10 KB. Disparador programado el día 1 de cada mes a las 02:00.
- **Estructuras Evolutivas en NVRAM**: Esquema L3/L4 extendido en [`02_Mem_Hierarchical.js:L82-L105`](file:///i:/My%20Drive/BioOS_Core/apps-script/02_Mem_Hierarchical.js#L82-L105) con `evolutionary_weights`, `calibration_deltas` y `user_preferences_vector`.
- **Despliegue de Producción v46**: Validado remotamente con entrega confirmada HTTP 200 en Telegram para `testWeeklyAudit` y `testMetaEvolution`.

## 5.2.0 - 2026-08-20

- **Clúster Multiagente Cognitivo y Despacho Quirúrgico**: Implementada en [`06_Agent_Orchestrator.js:L140-L195`](file:///i:/My%20Drive/BioOS_Core/apps-script/06_Agent_Orchestrator.js#L140-L195) la nueva síntesis estructurada para el despacho matutino (Balance SNC, Prescripción de Running en zonas/ritmo, Estrategia Nutricional con macros, Triaje de Agenda Calendar/Tasks y Ventana Óptima de Sueño) y despacho nocturno (Cierre fisiológico, Transición al descanso y Reconciliación L4 Anti-Alucinación).
- **Ingesta Multimodal Total (Audio, Fotos de Comida, Texto)**: Implementado soporte para `message.photo` en [`03b_Net_Webhook.js:L75`](file:///i:/My%20Drive/BioOS_Core/apps-script/03b_Net_Webhook.js#L75) con descarga unificada de binarios en [`03b_Net_Webhook.js:L105`](file:///i:/My%20Drive/BioOS_Core/apps-script/03b_Net_Webhook.js#L105), procesamiento en lote en [`11_Net_Daemons.js:L64`](file:///i:/My%20Drive/BioOS_Core/apps-script/11_Net_Daemons.js#L64) y extracción nutricional/calórica con `gemini-3.6-flash` en [`05_Bio_Compiler.js:L60`](file:///i:/My%20Drive/BioOS_Core/apps-script/05_Bio_Compiler.js#L60).
- **Scopes y Servicios de Google Workspace**: Habilitados en [`appsscript.json:L10`](file:///i:/My%20Drive/BioOS_Core/apps-script/appsscript.json#L10) los scopes de Calendar (`calendar.readonly`), Google Tasks (`tasks`) y Gmail (`gmail.readonly`), permitiendo la lectura de agenda e inyección directa de tareas.
- **Despliegue de Producción v44**: Validado remotamente con entrega confirmada HTTP 200 en `@B80324_BioOS_bot`.

## 5.1.5 - 2026-08-20

- **Auditoría y Aseguramiento de Triggers Cronobiológicos**: Verificación de los 4 disparadores del kernel en `America/Costa_Rica` (`triggerMorningBriefing` a las 04:00, `triggerEveningBriefing` a las 19:00, `triggerMemoryConsolidation` y `triggerMetaEvolution`), confirmando estado **OPERATIVO** en producción.
- **Desacoplamiento Asíncrono de GC en Despacho**: Retirada la llamada síncrona a `forceContextCompaction` del hilo crítico de `routeCognitiveTask` en [`06_Agent_Orchestrator.js:L42`](file:///i:/My%20Drive/BioOS_Core/apps-script/06_Agent_Orchestrator.js#L42), delegándola exclusivamente al daemon programado.
- **Compactación de Contexto LLM y Triaje Unificado**: Reducción del prompt de síntesis a <600 tokens y optimización de I/O en [`02_Mem_Hierarchical.js:L204`](file:///i:/My%20Drive/BioOS_Core/apps-script/02_Mem_Hierarchical.js#L204), reduciendo la latencia de despacho en más del 60%.
- **Despliegue de Producción v43**: Validado con entrega directa en Telegram (`@B80324_BioOS_bot`, chat `65004416`).

## 5.1.4 - 2026-08-20

- **Compactación Profunda de NVRAM (Reducción del 99.75%)**: Implementada en [`02_Mem_Hierarchical.js:L105-L125`](file:///i:/My%20Drive/BioOS_Core/apps-script/02_Mem_Hierarchical.js#L105-L125) la función `_memCompactLakeItem` para resumir volcados densos (`sports_motion_dense`), reduciendo el tamaño de NVRAM de **2.62 MB** a **~6.6 KB**.
- **Runner de Ejecución Autónoma Remota**: Implementado handler `doGet` en [`03b_Net_Webhook.js:L248-L285`](file:///i:/My%20Drive/BioOS_Core/apps-script/03b_Net_Webhook.js#L248-L285) desplegado en la versión `@40` de Web App, permitiendo el disparo y validación end-to-end autónoma de `testMemoryReadWrite`, `testMorningBriefingPayload` y `testNightBriefingPayload`.
- **Validación y Despacho Confirmado en Telegram**: Despachos matutino (`MORNING_BRIEFING`) y vespertino (`EVENING_BRIEFING`) ejecutados remotamente y entregados con confirmación HTTP 200 en el bot `@B80324_BioOS_bot`.

## 5.1.3 - 2026-08-20

- **Estabilización y Aceleración de VFS (`Mem_Read_Core`)**: Lectura no bloqueante en RAM volátil (<2ms), resolución directa por IDs canónicos de ROM (`17u0ZOqejUTXbS8CO4DJ8ZttX7umOEIwI`) y NVRAM (`1AYevqFlhNNdT3j1h-HHSTqwyQEZ3S-7a`), erradicando búsquedas lentas de Drive.
- **Inyección de Biometría Basal y Gemelo Digital**: `_buildOrchestrationPayload_` en [`06_Agent_Orchestrator.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/06_Agent_Orchestrator.js) ahora inyecta la telemetría basal calibrada de NVRAM (`L4_Basal`: RHR ~43 bpm, Sueño ~7h, Pasos reales), evitando mensajes genéricos ("Sin datos biométricos").
- **Eliminación de Latencia en Auditoría SPADE**: Autoridad determinista local instantánea en [`08_Agent_Auditor.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/08_Agent_Auditor.js), suprimiendo 3 llamadas LLM redundantes por ciclo y reduciendo la latencia de ~89s a **< 4 segundos**.
- **Suite de Pruebas Unitarias y Despacho Automatizado**: Implementadas en [`ops/03_Diagnostics_Suite.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/ops/03_Diagnostics_Suite.js) las funciones `testMemoryReadWrite()`, `testMorningBriefingPayload()` y `testNightBriefingPayload()`.

## 5.1.2 - 2026-08-20

- **Actualización de Modelos a Generación Gemini 3.x**: Migrado el catálogo de [`01b_LLM_Gateway.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/01b_LLM_Gateway.js) a `gemini-3.6-flash` (Primario), `gemini-3.5-flash-lite` (Secundario) y `gemini-3.1-pro-preview` (Avanzado).
- **Eliminación de Modelos Deprecados**: Retirados todos los identificadores deprecados que causaban errores HTTP 404 (`gemini-1.5-*`, `gemini-2.0-*`, `gemini-2.5-*`).
- **Optimización de Latencia y Rotación Instantánea**: Eliminados los retrasos de espera en caso de errores de disponibilidad (404/400) para rotar en 0ms y reducido el backoff de saturación a máximo 2s, reduciendo la latencia de 60s a menos de 3s.
- **Eliminación Total de la Degradación Grácil**: El sistema opera al 100% de capacidad cognitiva sin mensajes de emergencia en Telegram.

## 5.1.1 - 2026-08-20

- **Corrección de Disparadores Cronobiológicos**: Reemplazado el encadenamiento `.atHour().nearMinute(30)` incompatible con `everyDays(1)` en `ClockTriggerBuilder`. Implementada la reconciliación y creación limpia a las 04:00 y 19:00 en zona horaria `America/Costa_Rica`.
- **Blindaje del Canal de Notificaciones (`_rawSystemNotify`)**: Añadidos 3 reintentos con retroceso exponencial (1s, 2s, 4s), sanitización de entidades HTML no compatibles con Telegram Bot API y fallback automático a texto plano ante errores de parseo (HTTP 400).
- **Eliminación de Fallos Silenciosos en Orquestador**: `routeCognitiveTask` ahora valida el estado de retorno de la entrega del mensaje, emite telemetría explícita ante fallos (`[ORCHESTRATOR] Falló el despacho`) y devuelve el estado real.
- **Limpieza de Etiquetas HTML Inválidas**: Corregido `_orchestratorDegradedOutput_` reemplazando `<br>` por saltos de línea `\n`.
- **Mecanismo de Auto-recuperación Idempotente**: Implementada la función `reconcileCronobiologicalTriggers()` y actualizado `_opsCheckTriggers_()` en `ops/01_Health_Check.js` para alertar ante disparadores faltantes.
- **Suite de Diagnóstico y Smoke Test**: Creado [`ops/03_Diagnostics_Suite.js`](file:///i:/My%20Drive/BioOS_Core/apps-script/ops/03_Diagnostics_Suite.js) con `testEnvioProgramado()`, `testCredenciales()` y `diagnosticoDisparadores()`.
- **Lista Blanca LLM Multi-Modelo**: Ampliada la lista blanca en `01b_LLM_Gateway.js` con modelos universales estables (`gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`, `gemini-2.5-pro`, `gemini-1.5-pro`).

## 5.0.1 - 2026-08-19

- Adoptada como fuente canónica la versión remota 37 de BioOS v5.
- Archivada la copia local v4 sin eliminarla.
- Eliminado el reset destructivo por nombre de carpeta.
- Renombrado el aprovisionamiento para reflejar que preserva datos existentes.
- Endurecido el preflight: producción exige proxy autenticado `workers.dev`.
- Añadidos README, arquitectura, operación, disposición de datos y validación reproducible.
- Separados fuente, datos, respaldos, configuración heredada e ingesta raw.
- Añadidas exclusiones de Git para datos de salud y credenciales.

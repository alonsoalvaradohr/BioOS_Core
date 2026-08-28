# 📊 FLOW_DIAGRAMS.md — BIOOS CORE DIAGRAMAS DE FLUJO
## Diagramas Arquitectónicos, Flujos de Datos y Ciclos de Vida en Mermaid.js

---

## 1. Ingesta Multimodal & Ciclo Transaccional L0

Muestra cómo las notas de voz, fotos de comida y mensajes de texto son interceptados, autenticados bajo Zero-Trust, desacoplados en la cola durable `Queue_NLP` y procesados de manera asíncrona.

```mermaid
sequenceDiagram
    autonumber
    actor Usuario as 👤 Usuario (Telegram)
    participant Proxy as 🛡️ Cloudflare Proxy
    participant Webhook as ⚡ doPost (03b_Net_Webhook)
    participant Repo as 🗄️ DB_Repository (02b / Sheets)
    participant Worker as ⚙️ workerProcessNLP (11_Net_Daemons)
    participant Gateway as 🧠 LLM Gateway (Gemini 3.6)
    participant Orchestrator as 👑 Orchestrator (06)

    Usuario->>Proxy: Envía Nota de Voz / Foto / Texto
    Proxy->>Webhook: POST HTTPS (con Secret Token verificado)
    
    rect rgb(240, 248, 255)
        note over Webhook: Zero-Trust Auth & Payload Inspection
        Webhook->>Webhook: Extrae file_id / audio / imagen
        Webhook->>Usuario: Emite ACK Instantáneo (<200ms)
        Webhook->>Repo: repoEnqueueNLPBatch (Job encolado en Queue_NLP)
        Webhook->>Webhook: Programa trigger efímero workerProcessNLP
        Webhook-->>Proxy: Retorna HTTP 200 OK
    end

    rect rgb(255, 250, 240)
        note over Worker,Orchestrator: Procesamiento Asíncrono Desatendido
        Worker->>Repo: repoClaimNLPJobs (Lease adquirido, Status: processing)
        Worker->>Webhook: Descarga binario (Telegram getFile -> Base64)
        Worker->>Orchestrator: routeCognitiveTask('USER_FEEDBACK', multimodalPayload)
        Orchestrator->>Gateway: Transducción MOMA & Inferencia Activa
        Gateway-->>Orchestrator: Tensores Fisiológicos & Respuesta CoT
        Orchestrator->>Usuario: Despacho Táctico Telegram (_rawSystemNotify)
        Worker->>Repo: repoCompleteNLPJobs (Status: completed)
    end
```

---

## 2. Ciclo de Inferencia Activa y Cooldown Cognitivo L1

Ilustra la toma de decisiones del Orquestador evaluando telemetría de hardware real vs. modelo basal, el anclaje de contexto en L1 (<12h) y la ejecución de la Cadena de Pensamiento Clínica (CoT).

```mermaid
flowchart TD
    Start([Disparador: Briefing o Feedback]) --> SensorCheck{¿Telemetría Viva < 6h?}

    subgraph Biometria ["1. Determinación de Origen Biométrico"]
        SensorCheck -- SÍ --> LiveState["[HARDWARE_LIVE]<br/>RHR real, Pasos, Sueño, Calorías<br/>Cálculo de Deltas vs L4_Basal"]
        SensorCheck -- NO --> BlindState["[BASAL_NOMINAL]<br/>Ceguera Sensorial Activa<br/>Escudo Anti-Alucinación: Carga Mínima"]
    end

    LiveState --> L1Check
    BlindState --> L1Check

    subgraph Cognitivo ["2. Anclaje L1 & Cooldown (<12h)"]
        L1Check{¿Feedback cualitativo en L1 < 12h?}
        L1Check -- SÍ --> CooldownActive["🚨 COOLDOWN COGNITIVO ACTIVO<br/>• Integra síntomas y fatiga previa<br/>• PROHIBIDO preguntar redundancias"]
        L1Check -- NO --> ReceptiveMode["🔍 MODO RECEPTIVO<br/>• Si ceguera: 1 pregunta quirúrgica<br/>• Si online: evalúa deltas"]
    end

    CooldownActive --> Specialists
    ReceptiveMode --> Specialists

    subgraph Evaluacion ["3. Clúster de Especialistas & SPADE"]
        Specialists["Especialistas:<br/>Fisiólogo | Somnólogo | Endocrinólogo"]
        Specialists --> SpadeAudit{"Auditor SPADE<br/>(Puerta Determinista)"}
        SpadeAudit -- Violación de Seguridad --> SpadeCensor["Censura de Tarea & Prescripción<br/>[CENSURADO POR SPADE]"]
        SpadeAudit -- Conforme --> ApprovedHypothesis["Hipótesis Aprobada"]
    end

    SpadeCensor --> CoT
    ApprovedHypothesis --> CoT

    subgraph Sintesis ["4. Cadena de Pensamiento Clínica (CoT)"]
        CoT["🧠 razonamiento_clinico_oculto<br/>Deducción matemática paso a paso<br/>Veto Biomecánico ante dolor"]
        CoT --> TelegramMsg["📱 mensaje_telegram<br/>HTML Sanitizado, Emojis, Alta Densidad"]
        CoT --> TaskInject["📌 Google Tasks Inyectadas"]
    end

    TelegramMsg --> Egress([Despacho a Telegram @B80324_BioOS_bot])
```

---

## 3. Ciclo de Garbage Collection & Consolidación Jerárquica (L1 $\rightarrow$ L2 $\rightarrow$ L3 $\rightarrow$ L4)

Representa la compresión de contexto por Rate-Distortion y la minería semántica para prevenir la contención de memoria en Google Drive.

```mermaid
stateDiagram-v2
    [*] --> L1_Working: Ingesta de Eventos en Turno Activo

    state L1_Working {
        [*] --> BufferActive
        BufferActive --> AnxietyCheck: session_events.length >= 8
        AnxietyCheck --> CompactionTrigger: context_anxiety_flag = true
    }

    L1_Working --> L2_Episodic: forceContextCompaction() [Rate-Distortion Compression]

    state L2_Episodic {
        weekly_archives: Archivos Semanales Comprimidos
        raw_data_lake: Lago de Telemetría Podado (<150 KB)
    }

    L2_Episodic --> L3_Semantic: triggerWeeklySemanticConsolidation() [Minería de Datos]

    state L3_Semantic {
        medical_knowledge_graph: Lesiones Activas & Tendencias
        evolutionary_weights: Pesos Bayesianos de Agentes
        calibration_deltas: Deltas Prescripción vs Realidad
    }

    L3_Semantic --> L4_Basal: executeMonthlyMetaEvolution() [Día 1 de cada mes]

    state L4_Basal {
        DigitalTwin: Gemelo Digital Basal Nominal (RHR: 43, Steps: 8000, Sleep: 7.3h)
    }
```

---

## 4. Canal de Egress Resiliente & Dead-Letter Protocol

Muestra el pipeline de salida para garantizar que ningún mensaje se descarte en silencio (Zero-Silent-Drop), incluyendo sanitización HTML, balanceo de tags y fallback automático.

```mermaid
flowchart TD
    RawMsg[Mensaje de Salida en Bruto] --> Sanitize["_sanitizeTelegramHtml_<br/>Tokenizador + Tag Balancer + Auto-Truncate"]
    Sanitize --> Fetch["UrlFetchApp.fetch(sendMessage)"]
    
    Fetch --> CodeCheck{Código HTTP?}
    
    CodeCheck -- 200 OK --> Success([✅ Mensaje Entregado])
    
    CodeCheck -- 400 Bad Request<br/>(Parse Entities Error) --> FallbackPlain["Fallback Inmediato:<br/>Remover tags HTML y enviar texto plano"]
    FallbackPlain --> FetchFallback["UrlFetchApp.fetch(plainText)"]
    FetchFallback --> Success
    
    CodeCheck -- 429 Rate Limit / 5xx Server --> RetryBackoff["Backoff Exponencial con Jitter<br/>(Intento 1..3)"]
    RetryBackoff --> Fetch
    
    RetryBackoff -- Agotados 3 Reintentos --> DeadLetter["🚨 DEAD-LETTER PROTOCOL<br/>_dispatchDeadLetterPanic_"]
    DeadLetter --> EmergencyAlert["Emite alerta de pánico a Telegram con ID de transacción<br/>y aísla el job en cola L0"]
    EmergencyAlert --> Done([Canal Notificado / Zero Silent Drop])
```

---

## 5. Gobernanza de ROM & Meta-Evolución con Doble Verificación

Ilustra la arquitectura de seguridad estricta para la evolución de la memoria de solo lectura (`BioOS_ROM.json`), impidiendo mutaciones arbitrarias en tiempo de ejecución.

```mermaid
sequenceDiagram
    autonumber
    participant Engine as 🧬 Meta-Evolve Engine (10)
    participant LLM as 🧠 Gemini 3.6 Flash
    participant VFS as 🗄️ VFS Google Drive
    actor Operador as 👨‍💻 Ingeniero / Operador Humano

    Engine->>LLM: Analiza 30 días de desvíos y propone mutación de prompt
    LLM-->>Engine: Propuesta de nuevo prompt y justificación
    
    rect rgb(255, 240, 245)
        note over Engine,VFS: Aislamiento en Carpeta de Revisión
        Engine->>VFS: Guarda propuesta en `BioOS_ROM_Review_Audit/proposal_evo_xxx.json`
        Engine->>Engine: Status: PENDING_HUMAN_REVIEW (ROM permanece INMUTABLE)
    end

    Operador->>Engine: Inspecciona propuestas con listPendingROMProposals()
    
    rect rgb(240, 255, 240)
        note over Operador,VFS: Aprobación Explícita Tokenizada
        Operador->>Engine: approveROMProposal(id, BIOOS_OPS_APPROVAL_TOKEN)
        Engine->>Engine: Verifica token de 24+ caracteres
        Engine->>VFS: Crea snapshot `rom_before_xxx.json` con SHA-256
        Engine->>VFS: Aplica mutación a `BioOS_ROM.json`
        Engine->>VFS: Verifica integridad posterior (Hash Match)
        Engine-->>Operador: Retorna Confirmación y Version Hash
    end
```

# 🌌 ARCHITECTURE_MANIFEST.md — BIOOS CORE v8.5
## Manifiesto Fundacional, Filosofía del Exocórtex y Estado del Arte de la Ingeniería SRE

> **"El propósito absoluto de BioOS es la liberación cognitiva total de su usuario: tragar el ruido biológico, la entropía administrativa y la carga logística para devolver únicamente decisiones tácticas, proactivas y automatizadas con Cero Fricción."**  
> — *AGENT-PRIME, Dios del Repositorio & Arquitecto Jefe*

---

## 1. Declaración de Misión y Filosofía de Fricción Cero

### 1.1. La Paradoja Cognitiva del Ingeniero de Alto Rendimiento
El usuario de BioOS opera en la intersección de dos dominios de alta demanda alostática:
1. **Liderazgo Técnico e Ingeniería de I+D**: Diseño electromecánico, robótica cartesiana, visión computacional, instrumentación de bajo nivel, CAD/CAM y arquitectura de software embebido.
2. **Atleta de Resistencia Extrema**: Alto volumen de running de fondo en zonas aeróbicas (Z2/Z4, >60 km/semana) acoplado a fuerza estructural, donde una mala gestión del Sistema Nervioso Central (SNC) induce colapso cognitivo o lesiones tendinosas/articulares.

En un entorno tradicional, el seguimiento de estas variables genera **Fricción Cognitiva**: abrir aplicaciones, registrar comidas, interpretar gráficos de sueño, reprogramar calendarios y calcular balances calóricos o zonas de ritmo. Esta carga administrativa consume ancho de banda prefrontal que debería estar dedicado a la invención y resolución de problemas complejos.

### 1.2. El Exocórtex como Coprocesador Asíncrono de Inferencia Activa
BioOS no es una aplicación pasiva ni un chatbot reactivo; es un **Exocórtex Cognitivo Autónomo** desplegado en la nube de Google Apps Script (V8) e integrado de manera nativa con Telegram, Google Drive, Google Sheets, Google Calendar, Google Tasks y Google Fit.

Bajo la teoría de la **Inferencia Activa** (Friston, Karl), el sistema minimiza la sorpresa y la entropía libre de su usuario manteniendo un **Gemelo Digital Basal (`L4_Basal`)** y actualizando continuamente sus modelos causales mediante entradas multimodales (notas de voz, fotografías de alimentos, mensajes cortos, telemetría biométrica continua).

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EL BUCLE DE FRICCIÓN CERO                          │
│                                                                             │
│   [Mundo Físico / Usuario]                                                 │
│       │  ▲                                                                  │
│       │  │ (Directivas Tácticas / Egress Silencioso / Tareas Inyectadas)   │
│       ▼  │                                                                  │
│   [Capa de Ingesta Asíncrona (Telegram Webhook / Sensores)]                 │
│       │                                                                     │
│       ▼                                                                     │
│   [Transducción Multimodal MOMA & Desacoplamiento L0 en DB_Repository]      │
│       │                                                                     │
│       ▼                                                                     │
│   [Inferencia Activa: Clúster de Especialistas + SPADE + CoT Clínico]       │
│       │                                                                     │
│       ▼                                                                     │
│   [Memoria Jerárquica NVRAM L1-L4 & Poda por Rate-Distortion]               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Axiomas y Leyes Físicas del Sistema (Las Reglas de Hierro)

Todo componente, agente, script o refactorización dentro del repositorio BioOS Core está subordinado a **Siete Leyes Físicas Inmutables**:

### ⚖️ LEY 1: Veto de Cortesía Vacía y Generalidades
Queda estrictamente prohibido emitir frases de relleno (*"¡Buenos días!", "¿Cómo estás hoy?", "Espero que tengas un lindo día", "¿Tienes espacio en tu agenda?"*) o sugerencias pseudocientíficas triviales (*"Toma luz solar", "Camina un poco", "Bebe agua"*).  
**Directiva:** Toda interacción debe tener **Alta Densidad Táctica**, lenguaje sobrio, precisión de ingeniería y parámetros procesables inmediatos.

### ⚖️ LEY 2: Escudo Anti-Alucinación y Trazabilidad de Proveniencia
Queda estrictamente prohibido inventar o extrapolar métricas biométricas cuando el hardware está inactivo (`SENSOR_OFFLINE`).
- Si hay telemetría viva ($<6\text{h}$ de antigüedad) $\rightarrow$ El sistema opera en `[HARDWARE_LIVE]` y evalúa deltas reales vs basal.
- Si los sensores no responden $\rightarrow$ El sistema declara `[BASAL_NOMINAL]` (Ceguera Sensorial Activa), recurre al modelo nominal del Gemelo Digital, veta entrenamientos de alta intensidad y formula **exactamente UNA (1) pregunta quirúrgica** de reconciliación.

### ⚖️ LEY 3: Anclaje de Contexto L1 y Cooldown Cognitivo (<12h)
Si el usuario ya proporcionó contexto cualitativo en las últimas 12 horas (ej. *"me duele el sóleo derecho y dormí 5 horas"*), el sistema activa el **Cooldown Cognitivo**:
- Toda prescripción posterior (entrenamiento, macros, agenda) DEBE estar anclada a ese feedback.
- Queda **estrictamente vetado** interrogar nuevamente al usuario sobre variables que él ya declaró.

### ⚖️ LEY 4: Prioridad Absoluta de la Recuperación del SNC
La integridad neuromuscular y la recuperación central prevalecen siempre sobre el volumen deportivo o las metas de agenda. Si existe desacoplamiento cardiovascular o dolor mecánico articular, el sistema impone un **Veto Biomecánico**, anulando cualquier sesión de alta intensidad y prescribiendo descarga pasiva o movilidad.

### ⚖️ LEY 5: Zero-Silent-Drop y Dead-Letter Protocol en Egress
Ningún byte de datos, nota de voz, captura visual o mensaje entrante puede perderse en silencio. Si un procesamiento falla tras alcanzar el número máximo de reintentos:
- El estado transaccional se aísla en la cola de Dead-Letter (`Queue_NLP`).
- Se emite una alerta estructurada de pánico a Telegram (`_dispatchDeadLetterPanic_`), garantizando visibilidad total y canal siempre audible.

### ⚖️ LEY 6: Seguridad Fail-Closed y Determinismo de Autoridad (SPADE)
Ningún modelo de lenguaje (LLM) posee autoridad directa para ejecutar mutaciones destructivas en el mundo exterior (Google Tasks, Calendar, ROM). Toda hipótesis emitida por agentes pasa por el filtro determinista **SPADE** (`apps-script/08_Agent_Auditor.js`), el cual censura menciones farmacológicas, diagnósticos clínicos no autorizados o prescripciones lesivas.

### ⚖️ LEY 7: Inmutabilidad de ROM y Gobernanza Criptográfica
La memoria de solo lectura (`BioOS_ROM.json`) contiene los prompts maestros y axiomas de seguridad. Los módulos SRE y Meta-Evolución pueden diagnosticar y proponer mejoras; sin embargo, **ningún proceso desatendido puede mutar la ROM automáticamente**. Toda mutación requiere aprobación humana explícita mediante un token de 24+ caracteres (`BIOOS_OPS_APPROVAL_TOKEN`) y genera un snapshot histórico con hash SHA-256 para rollback atómico.

---

## 3. Topología de Capas y Arquitectura del Sistema

La arquitectura de BioOS Core está organizada en **7 Estratos Desacoplados**, siguiendo el principio de Responsabilidad Única (SOLID) y minimizando el acoplamiento en el entorno compartido de Google Apps Script:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ARQUITECTURA DE CAPAS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. CORE / CONTRATOS     │ Contratos puros, Result Type, Errores, Contexto   │
│                         │ (apps-script/core/00_Core_Contracts.js...)         │
├─────────────────────────┼───────────────────────────────────────────────────┤
│ 2. INGESTA / L0 REPO    │ Telegram Webhook, Queue_NLP, Leases, Sheets I/O   │
│                         │ (03b_Net_Webhook.js, 02b_DB_Repository.js)        │
├─────────────────────────┼───────────────────────────────────────────────────┤
│ 3. SENSORES BIOMÉTRICOS │ Multi-Provider: Mobvoi TicWatch (P1) + GFit (P2)  │
│                         │ (04_Sensor_Engine.js, apps-script/sensors/)       │
├─────────────────────────┼───────────────────────────────────────────────────┤
│ 4. TRANSDUCCIÓN MOMA    │ Compilador Multimodal: Audio, Visión, NLP         │
│                         │ (05_Bio_Compiler.js, 01b_LLM_Gateway.js)          │
├─────────────────────────┼───────────────────────────────────────────────────┤
│ 5. CLÚSTER COGNITIVO    │ Especialistas, SPADE Auditor, Orquestador CoT    │
│                         │ (06_Agent_Orchestrator.js, 07_Agent_Specialists)  │
├─────────────────────────┼───────────────────────────────────────────────────┤
│ 6. MEMORIA JERÁRQUICA   │ VFS Drive (ROM/NVRAM), Poda Rate-Distortion L0-L4 │
│                         │ (02_Mem_Hierarchical.js, 03_Mem_GC.js)            │
├─────────────────────────┼───────────────────────────────────────────────────┤
│ 7. RESILIENCIA & SRE    │ Watchdog, Dead-Letter, DeepDebug RCA, Telemetría  │
│                         │ (01_Sys_Telemetry.js, 09_SRE_DeepDebug.js)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Memoria Jerárquica y Virtual File System (VFS)

El sistema implementa un sistema de archivos virtual persistido en Google Drive mediante archivos JSON con validación de checksum FNV-1a y arquitectura de doble slot de recuperación:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ESTRUCTURA DE MEMORIA JERÁRQUICA                         │
├──────┬───────────────────────┬──────────────────────────────────────────────┤
│ CAPA │ NOMBRE TÉCNICO        │ PROPÓSITO, ESTRUCTURA Y POLÍTICA DE GC       │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│  L0  │ Ingestion Cursors     │ Estado de punteros de sincronización y cola  │
│      │ & Queue_NLP           │ transaccional en Google Sheets / Drive.      │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│  L1  │ Working Memory        │ Eventos de la sesión activa y turno actual.  │
│      │ (`session_events`)    │ Poda por Rate-Distortion si excede 10 items. │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│  L2  │ Episodic Lake         │ Archivo semanal (`weekly_archives`) y lago   │
│      │ (`raw_data_lake`)     │ de telemetría compactado a <150 KB.          │
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│  L3  │ Semantic Knowledge    │ Grafo médico (`lesiones_activas`), pesos     │
│      │ & Weights             │ evolutivos bayesianos y deltas de calibración│
├──────┼───────────────────────┼──────────────────────────────────────────────┤
│  L4  │ Basal Digital Twin    │ Parámetros del Gemelo Digital (RHR: 43 bpm,  │
│      │ (`user_preferences`)  │ Pasos: 8000, Sueño: 7.3h, horas de silencio) │
└──────┴───────────────────────┴──────────────────────────────────────────────┘
```

### 4.1. Resiliencia Atómica de Doble Slot (Slot A / Slot B)
Para evitar que un corte de energía o timeout en GAS corrompa el estado principal, `mutateNVRAM` escribe periódicamente copias firmadas en `BioOS_NVRAM.slotA.json` y `BioOS_NVRAM.slotB.json`. Si el archivo principal se invalida, el health check o el operador pueden invocar `repairNVRAMFromRecoverySlot('A'|'B')` en 0ms.

---

## 5. El Motor de Inferencia Activa y Cadena de Pensamiento Clínica (CoT)

La síntesis de decisiones no es una simple consulta textual a un LLM. El Orquestador (`06_Agent_Orchestrator.js`) fuerza un proceso en dos etapas estructurado mediante JSON Schema:

1. **`razonamiento_clinico_oculto`**: Cadena de pensamiento oculta (Chain-of-Thought) donde el modelo está obligado a:
   - Calcular matemáticamente los deltas de carga física y gasto calórico.
   - Cruzar los síntomas biomecánicos de L1 (ej. dolor en tendón de Aquiles) contra las sesiones previstas.
   - Justificar formalmente por qué veta o aprueba el entrenamiento antes de generar la respuesta final.
2. **`mensaje_telegram`**: Directiva táctica formateada en HTML estricto para el usuario, que resulta ser una consecuencia determinista del razonamiento clínico.
3. **`tareas_sugeridas`**: Inyección de compromisos técnicos en Google Tasks filtradas por la política de seguridad SPADE.

---

## 6. Canal de Egress Resiliente y Compatibilidad con Telegram HTML

La salida del sistema (`_rawSystemNotify` en `apps-script/01_Sys_Telemetry.js`) está blindada contra errores de parseo de la API de Telegram:
- **Tokenizador y Parser HTML**: Valida tags permitidos (`<b>`, `<i>`, `<code>`, `<pre>`, `<blockquote>`), escapa caracteres reservados (`<`, `>`, `&`) en texto literal y balancea de forma determinista la pila de etiquetas abiertas.
- **Auto-Truncado Inteligente**: Si el texto supera los 4000 caracteres, corta de manera segura y cierra todas las etiquetas abiertas antes de emitir.
- **Fallback a Texto Plano**: Si la API de Telegram responde con HTTP 400 (`can't parse entities`), el motor remueve instantáneamente todos los tags y reenvía en texto plano, garantizando entrega en el 100% de los casos.

---

## 7. Cronobiología e Idempotencia de Disparadores

El kernel opera sincronizado con la zona horaria `America/Costa_Rica` (UTC-6) mediante cuatro disparadores cronobiológicos gobernados por `reconcileCronobiologicalTriggers()`:

| Handler Canónico | Horario / Frecuencia | Propósito Táctico |
| :--- | :--- | :--- |
| **`triggerMorningBriefing`** | Diario a las 04:00 | Despacho matutino: Balance SNC, Prescripción running, Macros, Agenda y Ventana de Sueño. |
| **`triggerEveningBriefing`** | Diario a las 19:00 | Despacho nocturno: Cierre del día, Protocolo de desconexión SNC y Reconciliación L4. |
| **`triggerWeeklyAudit`** | Domingos a las 18:00 | Reporte dominical: Balance ACWR, Adaptación mitocondrial y Ajuste del microciclo. |
| **`triggerMonthlyMetaEvolution`** | Día 1 a las 02:00 | Calibración bayesiana mensual de pesos y consolidación profunda de memoria. |

---

## 8. Conclusión: El Estado del Arte de la Autonomía Cognitiva

BioOS Core representa la cúspide de la ingeniería de software aplicada a la cognición aumentada. Al encapsular la volatilidad biológica y operativa en contratos matemáticos, estructuras tolerantes a fallos y una arquitectura multi-agente rigurosa, BioOS transforma la interacción humano-máquina en una experiencia de **Cero Fricción, Máxima Eficiencia y Soberanía Cognitiva Total**.

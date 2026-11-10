# Roadmap BioOS Core

Estado del código fuente: 8.15.1 (`develop`, inspección local 2026-11-10). La prioridad es cerrar discrepancias entre repositorio, release, cobertura real de proveedor y consulta del segundo cerebro. Estado personal de cuenta/runtime aparece como `reported` cuando procede del usuario.

## Estado resumido

| Frente | Estado | Hecho verificable | Próximo hito |
|---|---|---|---|
| Harness de desarrollo | Implementado local/en `develop` | Contexto, política y tickets ejecutables; reglas en `AGENTS.md` | Mantener tickets y estado compacto sincronizados |
| Ingesta Telegram | Implementada en código | Proxy autenticado, webhook, cola y workers | Monitorizar entrega/atascos y reconciliar triggers del runtime |
| Google Fit REST | Implementado como ruta legacy/transitoria | Lector, diagnósticos HTTP y lector de sesiones/métricas | Medir por stream qué aporta Mi Fitness y migrar antes de retirada de Fit |
| Xiaomi → Health Connect | No implementado | No existe app/bridge Android aquí | Diseñar solo si Fit deja de ser vía suficiente |
| Memoria runtime | Parcialmente implementada | L2 estructurada, L3 reportada/vector local, L4 referencia; retención/límites | Asegurar consulta correcta en preguntas abiertas y pruebas end-to-end con runtime |
| Archivo histórico | Reencolado; falta observar ejecución | 2026-11-10: Telegram reporta 16/54 fuentes, 136 páginas, 137 shards, 130.192 puntos; tras pausa/reanudación, `Worker programado: sí` pero timestamps siguen en 2026-11-09 23:28:35Z | Esperar la tolerancia del trigger (hasta 20 min); si sigue sin avance, revisar ejecuciones y recuperar trigger/cursor |
| Briefings AM/PM | Cronotipo confirmado; ventanas de sueño y periodicidad necesitan ajuste | Alonso se levanta cerca de 03:50, procura acostarse antes de 21:00 y acepta hasta 20 min de latencia. Mantener reportes cerca de 04 y 19; no exigir 12 h de separación. Captura compartida de sueño, sin fecha visible. | Respetar ventanas de cronotipo; conectar sesiones/etapas de sueño y diseñar polling/deduplicación |
| Release a `main` | Pendiente de PR/revisión | `develop` está 33 commits delante de `main`, 0 detrás al inicio de esta tarea | Abrir PR; revisar CI/diff; el merge queda al propietario |
| Documentación pública/privada | Actualizada en este cambio | Portal, referencias, runbooks, Mermaid, seguridad y onboarding | Mantener al cambiar contratos o despliegues |

## Fases siguientes

### P0. Completar la reanudación y blindar el worker del archivo

- La ejecución de `/syncfit` sí ingirió datos: Telegram reporta 130.192 puntos. `16/54` es fuentes completas, no porcentaje del archivo. Antes de pausar, estaba huérfana (`Worker programado: no`); tras reanudar existe un trigger, pero falta comprobar que ejecuta.
- Alonso ya ejecutó `/syncfit pausa` y `/syncfit`. Telegram reportó `RUNNING` y `Worker programado: sí`, pero conservaba el timestamp previo. Esto demuestra que el trigger se reencoló, no que ya corrió una página. Google documenta [`after(ms)`](https://developers.google.com/apps-script/reference/script/clock-trigger-builder.html) como retraso mínimo; esperar la tolerancia operativa de 20 min antes de declarar que volvió a atascarse.
- Si después de 20 min no cambian `pagesProcessed` ni `lastProgressAt`, revisar Apps Script > Executions y el trigger runtime. Se intentó lectura remota owner mediante `clasp run diagnosticoDisparadores` y `Sensor_GoogleFit_archiveStatus_`; Google denegó ambas funciones por permisos, así que el error exacto del runtime sigue desconocido.
- Causa exacta del trigger perdido es `unknown` por falta de error persistido. Código permite que fallo al crear/recrear trigger deje job RUNNING sin trigger; además `/syncfit` devuelve “ya está activo” sin reparar RUNNING cuando falta trigger. El borrado del trigger está antes del `try`, y el reintento de scheduling puede fallar otra vez en el `catch`.
- Corrección: reconciliador idempotente que recupere RUNNING sin trigger o con heartbeat vencido; persistir errores de Apps Script/quotas y estado `PAUSED` accionable cuando no pueda reprogramar; trigger watchdog durable con ejecuciones acotadas; checkpoint bajo mutex y alarma de no avance. Preservar deduplicación, cursor y shards.
- Criterio: simular worker activo, trigger consumido, fallo de cuota al programar, reintento y pausa concurrente. Ningún caso puede quedar `RUNNING` sin worker programado o diagnóstico explícito.

### P1. Corregir los informes según cronotipo y telemetría de sueño

- Preferencia reportada por Alonso: levantarse cerca de 03:50, acostarse a más tardar cerca de 21:00 y aceptar hasta 20 min de latencia. Mantener reportes próximos a 04:00 y 19:00; no exigir una separación de 12 h. Semanal y mensual también deben usar ventanas de aceptación, con ejecución única idempotente, no instantes rígidos.
- Triggers de `11_Net_Daemons.js` usan `atHour(4)` y `atHour(19)`. La hora puede tener jitter; esto no asegura el SLA de +20 min. Evaluar un tick ligero con gate de aceptación y una marca persistente por periodo para deduplicar. Definir ventanas semanal/mensual antes de activarlas; hoy no ambas están en `canonicalTargets`.
- Código actual reporta AM con actividad de ayer 00:00–hoy 00:00 y PM desde hoy 00:00–hora de consulta. Son límites de día calendario, no vigilia. Usar el corte de cronotipo ~03:50–21:00 mientras no haya inicio/fin de vigilia observados; etiquetar la ventana como referencia. Si existen límites de sueño, priorizar límites reales.
- Sueño usa `sleepSinceMs = medianoche local - 6 h` en ambos informes; PM termina en mediodía aunque corre cerca de 19:00. Consultar la última sesión completa dentro de la ventana reciente (p. ej. últimos 24 h), por separado de actividad; no reutilizar un final fijo de mediodía.
- La captura que compartió Alonso no muestra fecha. Es evidencia reportada de que la interfaz ofrece asleep, time-in-bed, efficiency, horario, hora de cama/despertar y etapas; aún falta verificar cuáles campos expone la API autorizada.
- Fit REST documenta [sesiones de sueño](https://developers.google.com/fit/scenarios/read-sleep-data) (`activityType=72`) y [etapas](https://developers.google.com/fit/datatypes/health) (`com.google.sleep.segment`), y el manifest ya incluye `fitness.sleep.read`. `Sensor_GoogleFit_fetchSleepHistory_` lee esos recursos, pero `/syncfit` actualmente pagina datasets, no la colección de sesiones. Archivar/consultar ambos canales y comparar por fecha/fuente.
- Para una sesión observada: límites de sesión dan tiempo en cama; suma de etapas dormidas excluyendo Awake/Out-of-bed da asleep; efficiency = asleep / time-in-bed se etiqueta `derived`. Mostrar unidad, fuente, timestamps y ventana. No asumir que horario programado es una sesión observada; si no llega de la API, reportarlo desconocido. No poner cifras de la captura en Git.
- La agenda sigue desconectada y la síntesis AM/PM es determinista, no multiagente. Mantener estos límites claros.
- Criterio: pruebas en ventanas AM/PM del cronotipo, disparo en tolerancia ±20 min, dedupe semanal/mensual, sueño cruzando medianoche con/sin etapas, zona local, fechas, fuente y frescura; validar en Telegram con la misma fecha de Google Fit.

### 1. Completar y auditar la copia histórica

- Mantener datos raw en Drive privado, jamás en Git o embeddings externos.
- Esperar `COMPLETE`, revisar streams con denegación o cobertura parcial y conservar el resumen de auditoría.
- Probar consultas arbitrarias (cadencia, sesiones, sueño) contra archivo con origen, unidades, fechas y cobertura.
- Confirmar que el lector RAG/consulta raw realmente usa catálogo y shards; la existencia del archivo por sí sola no resuelve la amnesia.

### 2. Enlazar recuperación y respuesta

- Mantener el texto del usuario completo desde entrada hasta síntesis.
- Seleccionar store por intención de forma comprobable; no hardcodear una pregunta puntual como única solución.
- Instrumentar `query → route → stores → records/evidence → answer`, sin registrar salud sensible en logs.
- Hacer pruebas de aceptación con preguntas diversas y casos: dato presente, store vacío, permisos, sync incompleto, ambigüedad.
- Medir citas de evidencia correctas, recall relevante, abstención correcta, falsos ceros y respuestas fuera de ruta.

### 3. Sostener fuente biométrica

- El propietario indica Mi Fitness vinculado con Google Fit; verificar cada stream/ventana en runtime.
- Consultar campos existentes sin agregar scopes innecesarios. Distinguir punto no recibido, permiso denegado, fuente vacía y atraso de sincronización.
- Investigar Health Connect y origen Mi Fitness en dispositivo antes de construir puente; mantener modelo portable de proveedor y provenance.
- Google Fit REST es transición temporal: plan de migración documentado antes de deprecación efectiva.

### 4. Límites de prescripción

- AM resume vigilia del día anterior y PM resume vigilia del día actual, cada uno con su ventana explícita.
- No publicar promedio semanal, ACWR o tendencia hasta tener cobertura suficiente, al menos cuatro semanas para tendencias como exige el diseño anterior, y sesiones/resultados contrastables.
- Nunca generar RHR desde HR de ejercicio; ni entrenamiento/ritmo/macros/suplementos/sueño como certeza sin fuente.
- Mantener sistema como apoyo personal no clínico y evitar vetos/órdenes médicas deterministas sin justificación y revisión.

- Seguir el contrato AM/PM y reparación de ventanas descritos en P1; no inferir entrenamiento, vigilia o sueño desde totales agregados.

## Criterios de salida de la fase actual

- `/syncfit status` llega a `COMPLETE` o informa explícitamente fuentes/gaps que bloquean cobertura total.
- Una consulta genérica de historial recupera un dato raw pertinente, muestra procedencia/ventana y separa dato de usuario de proveedor.
- Casos negativos distinguen `not found`, `store unavailable`, `source denied` y `index incomplete`.
- PR `develop` → `main` revisado con checks de GitHub. No se considera release hasta que propietario hace merge y el despliegue GAS se valida aparte.

## No hacer

- No declarar Xiaomi/Health Connect enlazado por tener una ruta `health_connect` configurada.
- No llamar “memoria completa” a un backup raw sin lector ni índice operativo.
- No declarar cobertura por un `HTTP 200` vacío ni por una vista de app móvil.
- No subir archivos de salud a issues, Actions artifacts, repositorio o servicios vectoriales externos.

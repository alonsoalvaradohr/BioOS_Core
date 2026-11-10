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
| Archivo histórico | Progreso real reportado, pero worker huérfano | 2026-11-10: Telegram reporta 16/54 fuentes, 136 páginas, 137 shards, 130.192 puntos, `RUNNING`; último avance 2026-11-09 23:28:35Z; `Worker programado: no` | Recuperar cursor con pausa/reanudación; mejorar liveness/watchdog; confirmar `COMPLETE` |
| Briefings AM/PM | Ventanas parcialmente correctas; sueño y horario no cumplen contrato | Actividad usa fecha calendario local; configuración está en hora 04 y 19 (15 h, no 12 h); PM consulta sueño desde día anterior 18:00 hasta hoy 12:00 aunque el briefing corre ~19 h | Fijar contrato de 12 h y ventanas despiertas/sueño independientes; probar con horas reales |
| Release a `main` | Pendiente de PR/revisión | `develop` está 33 commits delante de `main`, 0 detrás al inicio de esta tarea | Abrir PR; revisar CI/diff; el merge queda al propietario |
| Documentación pública/privada | Actualizada en este cambio | Portal, referencias, runbooks, Mermaid, seguridad y onboarding | Mantener al cambiar contratos o despliegues |

## Fases siguientes

### P0. Recuperar y blindar el worker del archivo

- La ejecución de `/syncfit` sí ingirió datos: Telegram reporta 130.192 puntos. `16/54` es fuentes completas, no porcentaje del archivo. Sin embargo, `RUNNING` + `Worker programado: no` + último avance del día anterior demuestra que ahora está huérfana, no meramente esperando.
- Recuperación segura en la versión actual: `/syncfit pausa` y después `/syncfit`. El estado PAUSED conserva `sourceIndex`/`pageToken`; el segundo comando vuelve a crear el trigger. Luego verificar que páginas y último avance cambian y `Worker programado: sí`.
- Causa exacta del trigger perdido es `unknown` por falta de error persistido. Código permite que fallo al crear/recrear trigger deje job RUNNING sin trigger; además `/syncfit` devuelve “ya está activo” sin reparar RUNNING cuando falta trigger. El borrado del trigger está antes del `try`, y el reintento de scheduling puede fallar otra vez en el `catch`.
- Corrección: reconciliador idempotente que recupere RUNNING sin trigger; persistir errores de Apps Script/quotas y estado `PAUSED` accionable cuando no pueda reprogramar; trigger watchdog durable con ejecuciones acotadas; checkpoint bajo mutex y alarma de no avance. Preservar deduplicación, cursor y shards.
- Criterio: simular worker activo, trigger consumido, fallo de cuota al programar, reintento y pausa concurrente. Ningún caso puede quedar `RUNNING` sin worker programado o diagnóstico explícito.

### P1. Corregir el contrato de los briefings

- Código actual reporta AM con actividad de ayer 00:00–hoy 00:00 y PM con actividad de hoy 00:00–hora de consulta. Son días calendario, no horas reales de vigilia; deben etiquetarse así mientras no haya límites de sueño/vigilia verificables.
- Sleep usa `sleepSinceMs = medianoche local - 6 h` para ambos reportes. AM termina a la hora de ejecución; PM termina en mediodía del mismo día, aunque trigger corre cerca de 19:00. El intervalo PM queda atrasado y no representa ni la noche previa ni un sueño del día actual.
- Los triggers se crean con `atHour(4)` y `atHour(19)`; comentarios de 04:30/19:30 no son hora garantizada y el espaciamiento configurado es 15 h, no 12 h. Definir explícitamente dos ejecuciones separadas por 12 h en `America/Costa_Rica`.
- Ventanas esperadas: AM resume la vigilia anterior y el último sueño que terminó antes del briefing; PM resume la vigilia del día actual hasta su corte. Actividad, sueño y momento de lectura son intervalos distintos; ninguna ventana puede terminar en el futuro ni antes del momento de un briefing que pretende resumir el día actual.
- La salida actual no imprime los límites de sesiones de sueño aunque el provider los devuelve; solo imprime duración, y declara que no conoce bedtime. Corregir para mostrar bedtime/wake solamente cuando los registros contengan límites válidos. Si no hay marcadores, decir “día calendario” y no llamarlo vigilia observada.
- Agenda declara integración no conectada y nutrición/sesión confirmada ausentes; mantenerlo así hasta integrar fuentes. Las rutinas AM/PM evitan la cadena de especialistas y producen una síntesis determinista: no etiquetarla como análisis multi-agente.
- Criterio: tests en medianoche, antes/después del corte y con/sin sesión de sueño; validar en Telegram una mañana y una tarde contra fechas de Mi Fitness/Google Fit, zona local, source, freshness y límites exactos.

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

# BioOS Second Brain Harness

Harness de trabajo para agentes humanos y automáticos en BioOS Core. El objetivo es conservar contexto operativo entre sesiones, hacer cambios acotados y distinguir evidencia real de hipótesis. No es un agente que inventa conocimiento ni una autorización para operar producción.

## Arranque y contexto

```powershell
npm run harness -- context
npm run ticket -- new BIOOS-YYYYMMDD-01 --title "Una meta observable"
npm run ticket -- check BIOOS-YYYYMMDD-01
```

`context` informa rama, commit, limpieza del árbol, versión fuente y mapa de documentos. No lee datos biométricos. `ticket new` crea un archivo en `docs/tickets/active/`. `ticket check` comprueba campos, criterios, resumen y que los archivos cambiados respeten los patrones `Scope in` del ticket. El único archivo excluido de ese control es el ticket que se está comprobando.

Estados permitidos: `DIAGNOSIS`, `IN_PROGRESS`, `READY_FOR_REVIEW`, `DONE`, `BLOCKED`. Un ticket DONE necesita criterios marcados, cinco líneas de cierre y evidencia de validación o un `NOT RUN` explicado. El check no afirma que la evidencia sea verdadera; el agente debe citar registros y no adjudicar PASS a un comando no ejecutado.

## Cómo se conserva el “cerebro”

| Necesidad | Fuente durable |
|---|---|
| Reglas que carga cada sesión | `AGENTS.md` |
| Arquitectura y flujo del sistema | `docs/ARCHITECTURE.md` |
| Bloqueadores y fases actuales | `docs/ROADMAP.md` |
| Operación/release | `docs/OPERATIONS.md` |
| Trabajo en curso y evidencia | `docs/tickets/active/` |
| Decisiones cerradas por ticket | `docs/tickets/closed/` y commits |
| Resumen de estado breve | `docs/agent-harness/STATE.md` |
| Cambios por versión | `CHANGELOG.md` |

No dupliques conocimiento en un segundo “brain dump”. Al cerrar una tarea, registra solo decisiones duraderas, estado verificable y siguiente paso. Cada hecho de estado debe incluir fecha, fuente o commit, y etiqueta `observed`, `reported`, `derived` o `unknown`.

## Ciclo

1. Contexto → ticket → diagnóstico de solo lectura si la causa no está clara.
2. Define lo que Alonso observa al terminar y limita rutas permitidas/prohibidas.
3. Implementa el cambio mínimo; separa refactor y mejoras no necesarias.
4. Comprueba alcance con `npm run ticket -- check <ID>`; registra comandos ejecutados/no ejecutados.
5. Resume: OBJETIVO, PUNTO, VISTO, CAUSA, SIGUIENTE. Commit local. Push solo con autorización A2.

## Políticas específicas BioOS

- La ruta que Alonso ya usa es Mi Fitness → Google Fit, leída por el OAuth REST existente; el motor intenta ese fallback mientras no responda Health Connect. `/doctor` debe confirmar en runtime campos/frescura. Health Connect con bridge Android es la migración futura de Google Fit, no una conexión asumida.
- `heart_rate.bpm` de ejercicio no equivale a RHR. Mantén fuente, timestamp, unidad y ventana temporal en toda métrica.
- No deduzcas entrenamiento, macros, sueño, agenda o estado SNC desde pasos, calorías basales o telemetría ausente.
- No aprendas ni ajustes pesos persistentes a partir de texto generado. Primero outcome confirmado, temporalidad y procedencia.
- CI verde comprueba el código que ejecutó CI; no prueba sincronización Xiaomi, despliegue, consentimiento, exactitud médica ni comportamiento del runtime.
- Producción queda fuera de autonomía por defecto: leer/preparar sí; desplegar, cambiar triggers o datos reales requiere autorización A3.

## Reglas del equipo CRAIA adaptadas

Se conservan las partes transferibles del harness CRAIA: un ticket por conversación, diagnóstico antes del cambio cuando hay incertidumbre, alcance pequeño, archivos permitidos/prohibidos, stop rule tras dos intentos o 15 minutos sin evidencia nueva, resumen de cinco líneas y commit rastreable. Las reglas de robot físico, firmware, puertos serie y límites SRAM de KinetiX no aplican a BioOS y no se copian.

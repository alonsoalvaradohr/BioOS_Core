# AGENTS.md — BioOS Core

Este archivo es el punto de entrada obligatorio para cualquier agente que trabaje en el repositorio.

## Misión y límites

BioOS es software experimental de registro y apoyo personal. No es un dispositivo médico ni debe presentar inferencias como mediciones. Distingue siempre `observed` (registro con fuente y hora), `reported` (lo dijo Alonso), `derived` (cálculo reproducible con entradas citadas) y `unknown`. Ausencia de dato nunca significa cero, normalidad o recuperación.

- Trabaja solo en este repositorio y dentro del alcance explícito del ticket.
- No publiques datos biométricos, credenciales, archivos exportados de salud ni IDs privados en código, logs, commits o comentarios.
- No inventes telemetría, estado de agenda, sesiones, diagnóstico, disponibilidad de servicios o resultados de pruebas.
- No leas ni expongas `data/raw/`, backups, NVRAM real ni archivos de credenciales salvo que el ticket lo requiera expresamente; comparte solo agregados mínimos.
- No hagas cambios en un runtime, Apps Script deployment, wearable, cuenta de salud, webhook o servicio externo como parte de una tarea de código.
- No crees tags de producción, publiques release, migres datos reales ni envíes comunicaciones externas sin autorización explícita de Alonso para esa acción concreta.

## Flujo por ticket

1. Ejecuta `npm run harness -- context` y lee solo los documentos y segmentos de código relevantes. No abras archivos grandes completos; usa búsqueda y líneas focalizadas.
2. Crea un ticket con `npm run ticket -- new BIOOS-YYYYMMDD-NN --title "..."`, o usa uno existente en `docs/tickets/active/`.
3. En modo diagnóstico, solo lectura: devuelve ubicación, evidencia, causa probable, alternativa y la observación/prueba que las distinga. No edites.
4. En modo implementación, respeta `Scope in`/`Scope out`, haz el cambio mínimo y conserva evidencia para cada criterio de aceptación. Evita alcance lateral.
5. Tras dos intentos sin información nueva o 15 minutos sin avance concreto, detente y registra qué dato falta.
6. Actualiza ticket, conclusión de cinco líneas y `docs/agent-harness/STATE.md` cuando corresponda. Ejecuta `npm run ticket -- check <ID>` antes del commit.
7. Ejecuta verificaciones relevantes disponibles y registra su resultado; nunca declares PASS si no las corriste. Si el usuario no pidió pruebas y las reglas de la sesión las prohíben, deja explícito `NOT RUN`.
8. Crea commits locales pequeños, con mensaje que describa el cambio. Empuja solo cuando el ticket/instrucción del usuario lo autorice y solo a `develop` o a una rama de trabajo; no empujes directo a `main`.

## Autoridad para acciones

| Nivel | Acciones | Regla |
|---|---|---|
| A0 | Leer repo, buscar evidencia, inspeccionar historial | Autónomas |
| A1 | Editar archivos versionados, ejecutar validación local, crear commit local | Requiere ticket activo y alcance explícito |
| A2 | Push a rama no protegida, abrir PR | Requiere autorización explícita en solicitud o ticket |
| A3 | Actualizar deployment, publicar release/tag, tocar datos/runtime de producción, emitir consejo de entrenamiento cuantificado | Requiere autorización explícita para la acción y destino exactos |

Un ticket y un contexto de trabajo por cambio. No uses múltiples agentes o chats paralelos salvo petición expresa de Alonso.

## Fuentes de verdad

Lee [docs/agent-harness/README.md](docs/agent-harness/README.md) para el mapa del proyecto, [docs/ROADMAP.md](docs/ROADMAP.md) para bloqueos vigentes, [docs/OPERATIONS.md](docs/OPERATIONS.md) para release y [docs/tickets/TEMPLATE.md](docs/tickets/TEMPLATE.md) para tickets. El código y la evidencia runtime fechada prevalecen sobre documentación histórica. Los reportes, nombres de agentes y auditorías antiguas no prueban que algo siga desplegado.

# Contribuir a BioOS Core

BioOS Core es privado y experimental. Las contribuciones deben poder auditarse, revertirse y explicar de dónde sale cada afirmación.

## Flujo de trabajo

1. Revisa `AGENTS.md`, [arquitectura](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md) y tickets activos relacionados.
2. Crea un ticket con un resultado observable, evidencias etiquetadas, `Scope in/out`, aceptación y reversión: `npm run ticket -- new BIOOS-YYYYMMDD-NN --title "..."`.
3. Ejecuta `npm run harness -- context` y trabaja desde `develop` actualizado con `git pull --ff-only origin develop`.
4. Mantén el cambio en alcance. No introduzcas datos personales ni IDs/secretos en fixtures, capturas o documentación.
5. Corre `npm run check`, `npm test`, `npm run ticket -- check <ID>` y `git diff --check`; anota comandos no ejecutados y por qué.
6. Escribe commits descriptivos y pequeños. Publica en rama de trabajo y abre PR hacia `develop` o, para una promoción revisada, hacia `main` según el ticket y la autorización explícita.

## Criterios de calidad

- No mezcles telemetría observada, datos reportados por el usuario, derivaciones y ausencias.
- Usa fechas/ventanas y unidades; no reemplaces `null` por cero.
- Mantén los lectores de salud con autorización mínima y nunca añadas scopes como atajo.
- Tests deben ser herméticos y no escribir en Drive, Telegram, wearable o deployment productivo.
- Documenta contratos, errores, límites, recuperación y reversión, no solo la lista de módulos.
- Cada PR describe problema, solución, alcance, riesgos, pruebas y evidencia de release; CI no sustituye validación runtime.

## Exclusiones por defecto

Despliegue GAS, cambio de triggers/webhook, modificación de datos reales, reautorización del propietario, envío de mensajes externos y merge a `main` requieren autorización apropiada. Un PR puede prepararse sin hacer merge.

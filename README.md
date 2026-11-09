# BioOS Core v8.7.0

Sistema experimental sobre Google Apps Script y Node.js para ingesta, memoria estructurada, automatización y reportes. El estado del código, Apps Script, Health Connect y Telegram se reportan por separado; una versión en Git no demuestra que esté desplegada.

## Arquitectura actual del código

```text
Telegram → proxy autenticado → Apps Script doPost → Queue_NLP (Sheets)
        → worker / compilador → política de decisión → orquestador
        → memoria VFS (Drive, L0-L4) → respuesta Telegram

Mi Fitness → Health Connect → puente Android (pendiente) → proveedor BioOS
```

El proxy valida el secreto de Telegram antes de entregar el evento a Apps Script. La cola conserva entradas para procesamiento asíncrono y reintentos. La salida se sanitiza antes del envío.

## Memoria

- `BioOS_ROM.json`: configuración de agentes e invariantes.
- `BioOS_NVRAM.json`: estado durable en capas L0 cursores, L1 trabajo, L2 episodios/data lake, L3 semántica/calibración y L4 perfil basal.
- Dos slots de recuperación conservan snapshots verificables. La restauración requiere una acción explícita.
- La guía operativa y el resumen del second brain están en [docs/agent-harness/README.md](docs/agent-harness/README.md) y [docs/agent-harness/STATE.md](docs/agent-harness/STATE.md).

## Evidencia y automatización

Los briefings AM/PM son deterministas: informan campos observados y marcan los ausentes. No generan ritmo, macros, suplementos, horario de sueño ni estado de agenda sin fuente suficiente. La frecuencia cardíaca durante ejercicio no se usa como RHR.

Solo se programan briefings de mañana y noche. Auditoría semanal/ACWR y ajuste mensual quedan desprogramados hasta contar con sesiones y resultados confirmados por Alonso. Los límites de evidencia y autonomía están en [AGENTS.md](AGENTS.md).

## Sensores y límites vigentes

BioOS no contiene el puente Android que lea Health Connect del Xiaomi Watch 2/Mi Fitness. Sin ese componente y su autorización, el runtime debe informar que la fuente no está conectada. RHR debe permanecer ausente si no existe una medición de reposo con fuente y fecha válidas.

## Operación

```powershell
npm run harness -- context
npm run harness -- policy
npm run ticket -- new BIOOS-YYYYMMDD-01 --title "Meta observable"
npm run ticket -- check BIOOS-YYYYMMDD-01
npm run check
```

Consulta [docs/ROADMAP.md](docs/ROADMAP.md) para bloqueadores y [docs/OPERATIONS.md](docs/OPERATIONS.md) para despliegue. GitHub Actions valida cambios; los tags `vX.Y.Z` publican los deployments indicados explícitamente en el secret de release. Ningún workflow instala Health Connect ni sustituye una revisión de `/doctor`.

El reporte operativo completo se puede enviar por Telegram mediante la ejecución API de Apps Script, restringida al propietario (`MYSELF`). No debe añadirse un endpoint GET público para enviar mensajes o invocar tareas internas.

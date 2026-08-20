# Operación y despliegue

## Propiedades requeridas

Configurar en Script Properties, nunca en archivos versionados:

- `GEMINI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_SECRET_TOKEN`
- `BIOOS_WEB_APP_URL`: URL HTTPS del proxy autenticado `workers.dev`
- `BIOOS_DB_ID`: recomendado para evitar búsquedas ambiguas
- `BIOOS_OPS_APPROVAL_TOKEN`: mínimo 24 caracteres; requerido para migraciones y emergencias
- `VFS_FOLDER_ID`, `VFS_ROM_ID`, `VFS_NVRAM_ID`: recomendados tras aprovisionar almacenamiento

## Validación y release

```powershell
npm run verify
clasp status
clasp push
clasp version "BioOS v5.1.0 - runtime hardening"
clasp deployments
```

Para producción, actualizar un deployment existente con `clasp redeploy`; conservar una sola URL estable por entorno. No ejecutar `registerTelegramWebhook()` hasta que `BIOOS_WEB_APP_URL` apunte al proxy y `preflightDeployment()` termine sin advertencias.

## Funciones operativas

| Función | Efecto |
|---|---|
| `healthCheckBioOS()` | Informe de solo lectura |
| `preflightDeployment()` | Bloquea release ante fallos o advertencias |
| `bootBioOS()` | Confirma readiness; no provisiona ni despliega |
| `provisionBioOSStorage()` | Crea únicamente particiones ausentes |
| `QA_RunIsolatedSuite()` | Pruebas con fakes, sin producción |
| `repairNVRAMFromRecoverySlot('A'|'B')` | Recuperación explícita desde slot verificado |
| `getRuntimeStateSummary()` | Resumen seguro de ROM, NVRAM y capacidades |
| `migrateNVRAMToCurrentSchema(token)` | Migra y crea un slot verificable; requiere aprobación |
| `installCanonicalV5Prompts(token)` | Añade solo prompts faltantes y crea snapshot ROM |
| `emergencyStopManagedTriggers(token)` | Detiene solo triggers administrados; conserva la cola |
| `emergencyPurgeQueue(token, 'PURGE_QUEUE')` | Purga explícita de cola con doble confirmación |

`executeFactoryResetVFS()` y la función heredada `emergencyStopAndPurge()` están deliberadamente deshabilitadas y siempre lanzan un error.

## Rollback

1. No sobrescribir NVRAM manualmente.
2. Identificar el último slot válido mediante el health check y los metadatos de generación.
3. Ejecutar `repairNVRAMFromRecoverySlot` con el slot elegido.
4. Para código, reasignar el deployment estable a una versión anterior mediante `clasp redeploy`.
5. Ejecutar nuevamente el preflight y una prueba controlada del proxy.

## Despliegues históricos

No eliminar deployments únicamente por antigüedad. Primero hay que verificar qué URL utiliza el proxy, Telegram y cualquier integración externa. Una vez identificado el deployment estable, los demás pueden retirarse en una ventana de mantenimiento documentada.
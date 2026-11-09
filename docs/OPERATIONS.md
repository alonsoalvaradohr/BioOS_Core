# Operacion y release

## Propiedades de runtime

Configurar secretos en Apps Script Script Properties, nunca en archivos versionados. La compatibilidad actual con Mi Fitness aun requiere un puente Android autorizado que escriba snapshots firmados en el endpoint que se implemente; no almacenar un access token OAuth en NVRAM.

- `GEMINI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_SECRET_TOKEN`
- `BIOOS_WEB_APP_URL`: URL HTTPS del proxy autenticado
- `BIOOS_SENSOR_PROVIDER`: `health_connect` (default; no disponible sin puente), `mobvoi` o `google_fit_legacy` solo para instalaciones antiguas
- `BIOOS_DB_ID`
- `BIOOS_OPS_APPROVAL_TOKEN`: minimo 24 caracteres para migraciones protegidas
- `VFS_FOLDER_ID`, `VFS_ROM_ID`, `VFS_NVRAM_ID`
- `MOBVOI_API_ENDPOINT`, `MOBVOI_API_TOKEN` (solo si Mobvoi sigue siendo fuente activa)

## Validacion local

```powershell
npm run check
```

La validacion no demuestra que sensores, VFS, proxy o Telegram funcionen en runtime. Revisar `/doctor` tras un despliegue autorizado; no hay smoke test remoto que escriba en memoria o envíe mensajes de prueba.

## Release a GAS

El deploy automatizado actualiza únicamente los deployments explícitamente listados; admite uno o una lista CSV para cerrar deployments duplicados. Antes de publicar un tag, confirmar que `BIOOS_CONFIG.VERSION` coincide exactamente con el tag (`v8.7.0` para version `8.7.0`) y que `BIOOS_GAS_DEPLOYMENT_ID` o `BIOOS_GAS_DEPLOYMENT_IDS` apunta al deployment realmente usado por Telegram/proxy.

Configurar en GitHub Actions:

- `GAS_CLASPRC_JSON`: contenido de la credencial clasp con permisos de Apps Script API, guardado como secret.
- `BIOOS_GAS_DEPLOYMENT_ID` o `BIOOS_GAS_DEPLOYMENT_IDS`: ID del deployment estable que se permite actualizar.
- Environment `production` para el job de release.

El job se activa con tags `v*`, verifica el tag contra la version del codigo y solo actualiza los IDs listados. Crea un deployment nuevo de ejecución API para cada versión (Google marca los deployments API como no modificables) con acceso `MYSELF`. Para invocarlo con `scripts.run`, configura el proyecto Apps Script para usar el mismo proyecto estándar de Google Cloud que el cliente OAuth, habilita Apps Script API y autoriza todos los scopes del script. Un 403 `caller does not have permission` indica que ambos proyectos Cloud no coinciden. El script de despliegue no escribe el token OAuth renovado sobre `~/.clasprc.json`.

No publicar una version mientras el preflight tenga FAIL/WARN relevante o el destino estable no este identificado. El despliegue modifica el codigo GAS y la version de un deployment; no autoriza ni instala por si mismo permisos de Health Connect, no crea la app Android y no configura el proxy.

## Recuperacion

1. No sobrescribir la NVRAM manualmente.
2. Identificar el slot de recuperacion verificado.
3. Restaurar mediante `repairNVRAMFromRecoverySlot`.
4. Reasignar el deployment estable a una version GAS anterior.
5. Verificar de nuevo estado de VFS, proveedor biometrico, proxy y mensajeria.

# Configuración y seguridad

BioOS usa Google Apps Script, Telegram, un proxy de entrada y almacenamiento en Google Drive/Sheets. La configuración real vive en Script Properties y secretos del entorno de release; nunca en archivos del repositorio, tickets, logs, screenshots o vectores.

## Variables de runtime

| Propiedad | Uso | Precaución |
|---|---|---|
| `GEMINI_API_KEY` | Gateway de lenguaje configurado | Tratar como secreto; validar proveedor/modelo antes de enviar contenido |
| `TELEGRAM_BOT_TOKEN` | Envío de mensajes | Nunca incluir en URL de webhook, logs o Markdown |
| `TELEGRAM_CHAT_ID` | Identidad de chat autorizada | Dato privado; restringir a propietario |
| `TELEGRAM_SECRET_TOKEN` | Validación del evento entrante en proxy | Comparación fail-closed; no exponer en payload/log |
| `BIOOS_WEB_APP_URL` | URL del proxy HTTPS autenticado | No usar URL GAS pública para saltar el proxy |
| `BIOOS_SENSOR_PROVIDER` | `health_connect`, `mobvoi` o `google_fit_legacy` | Sin bridge HC, el motor puede usar Google Fit como compatibilidad; comprobar `/doctor` |
| `BIOOS_DB_ID` | Repositorio persistente | Identificador privado |
| `VFS_FOLDER_ID`, `VFS_ROM_ID`, `VFS_NVRAM_ID` | Configuración y memoria en Drive | IDs solo en Script Properties |
| `BIOOS_OPS_APPROVAL_TOKEN` | Aprobaciones protegidas | Mínimo indicado por código; nunca se escribe en Git |
| `MOBVOI_API_ENDPOINT`, `MOBVOI_API_TOKEN` | Proveedor Mobvoi opcional | Configurar solo si se usa esa integración |

Revisar nombres vigentes en `apps-script/00_Sys_Config.js` y `docs/OPERATIONS.md`; el código es la autoridad si la lista documental difiere.

## Consentimiento y permisos

El manifiesto OAuth está en `apps-script/appsscript.json`. Los scopes afectan acceso a datos personales y deben cambiarse solo en un ticket que detalle necesidad, mínimo alcance, consentimiento, reversión y pruebas. La autorización de un scope no garantiza que Google Fit tenga registros de la fuente Mi Fitness ni que los entregue para la ventana consultada.

El lector actual de Google Fit es una ruta cloud legado/transitoria. No hay aplicación Android ni bridge Health Connect en este repositorio. El usuario debe confirmar en `/doctor` estado, ventana, métricas y diagnóstico por endpoint; no se solicita reautorización repetida si el proveedor ya confirma scope autorizado.

## Límites de seguridad

- El webhook directo de GAS no recibe las cabeceras originales que Telegram usa para secreto; usar el proxy autenticado y mantener el endpoint directo cerrado.
- `doGet` está reservado para health/ping. No enviar comandos, mutar datos ni ejecutar tareas por GET.
- Los datos de salud crudos se guardan solo en Drive privado del propietario. Nunca en Git, CI artifacts, issues, PR, logs o embeddings externos.
- Vectores locales son representaciones hash de características/alias, no cifrado ni embeddings preentrenados; no vectorizar telemetría cruda.
- `/doctor` es diagnóstico de disponibilidad, no lectura en vivo de pulso ni consejo médico.
- El workflow de PR verifica; el job de despliegue corre solo para tags `v*` con environment `production` y secrets configurados.

## Rotación y respuesta a exposición

Si un secreto se expuso: revócalo/rotalo en el proveedor, reemplaza la Script Property/secret, revisa y elimina el valor expuesto del historial si aplica, y valida `/ping`/`/doctor` después. No pegues aquí el secreto para depurarlo.

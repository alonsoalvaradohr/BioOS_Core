# Operación y releases

Separa validación de código, configuración, publicación GAS y observación del runtime. Despliega solo con autorización A3 del propietario cuando aplique.

## Checks antes de PR

```powershell
npm run harness -- context
npm run harness -- policy
npm run check
npm test
npm run ticket -- check BIOOS-YYYYMMDD-NN
git diff --check
```

`.github/workflows/bioos-deploy.yml` corre `npm run check` y `npm run harness -- policy` en push/PR a `main` y `develop`. Para tags `v*`, `deploy` espera `verify`, usa environment `production` y secrets de clasp/deployments. Revisa GitHub para afirmar CI PASS.

## Validar runtime sin mutarlo

1. `/ping`: endpoint y versión reportada.
2. `/doctor`: proveedor, consulta, ventanas, campos y status HTTP por endpoint.
3. Consulta funcional: comprueba que el router leyó la pregunta y usó el store pertinente.
4. `/syncfit status`: progreso y cobertura del archivo.

`ONLINE` no prueba sensores; `HTTP 200` no garantiza puntos; scope autorizado no prueba sincronización; tener archivo en Drive no prueba que el lector lo consultó.

## Configuración

Las propiedades viven en Script Properties. Ninguna credencial entra al repo. Consulta [configuración y seguridad](CONFIGURATION.md) y los nombres vigentes en `apps-script/00_Sys_Config.js`. Cambiar scopes OAuth requiere ticket, mínimo alcance, consentimiento, reversión y validación; repetir `/reauth` no corrige un 403 cuando el scope está autorizado.

## Release de Apps Script

`scripts/deploy-gas.mjs` actualiza solo deployment IDs explícitos. GitHub Actions requiere `GAS_CLASPRC_JSON`, `BIOOS_GAS_DEPLOYMENT_ID` o `BIOOS_GAS_DEPLOYMENT_IDS`, opcional `BIOOS_GAS_EXECUTION_DEPLOYMENT_ID` y environment `production`.

Antes de crear tag, verifica que `BIOOS_CONFIG.VERSION` corresponde a `v<version>`, revisa destinos estables, checks y revisión. El workflow despliega GAS al crear tag `v*`; merge de PR no despliega. Tampoco crea el bridge Android, autoriza Health Connect ni configura el proxy.

Para Apps Script Execution API, el proyecto GAS y el cliente OAuth deben compartir el proyecto estándar de Cloud y tener Apps Script API habilitada. Un `403 caller does not have permission` puede deberse a esa vinculación aunque el web endpoint funcione. No crees nuevos owner API deployments como workaround.

## Archivo histórico Google Fit

El archivador lee y guarda en Drive BioOS del propietario, sin escribir en Google Fit.

1. `/syncfit` inicia o reanuda.
2. `/syncfit status` muestra estado, fuentes terminadas, shards/puntos/páginas, fuente actual, último avance, worker y gaps.
3. Fuentes terminadas aumenta al completar el stream; una fuente grande puede tener shards/puntos mientras sigue `0/N`.
4. `/syncfit pausa` pausa conservando cursor/shards confirmados; `/syncfit` reanuda.
5. Solo status `COMPLETE` con gaps/errores revisados permite hablar de archivo completo; no implica que cada métrica de Mi Fitness esté disponible.
6. Prueba consulta por ventana y verifica unidad, procedencia y cobertura.

No borres shards/catálogo ni los incluyas en Git. Una reversión de código no elimina archivos de Drive.

## Recuperación

### NVRAM

No edites JSON de producción a mano. Identifica slot/generación, valida checksum y esquema, usa `repairNVRAMFromRecoverySlot` bajo autorización y registra estado antes/después.

### Release GAS

Reasigna el deployment estable a una versión previa, luego verifica `/ping`, `/doctor`, memoria y mensajería. Revertir código Git no revierte publicación GAS.

### Archivo

El archivador es read-only respecto al proveedor. No purgues archivos privados salvo procedimiento explícito de retención/borrado.

## Medición operativa

BioOS no declara todavía un SLO cuantificado. Para definirlo, medir por versión la tasa de ingestión/duplicados, latencia, jobs atascados, frescura/cobertura por stream, éxito de retrieval, abstenciones correctas, errores de envío y triggers. No presentar un SLO sin series observadas.

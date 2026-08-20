# Estado del arte y roadmap

Auditoría base: 2026-08-19. Este documento distingue lo resuelto en código de lo que exige una operación explícita sobre el runtime de Google Apps Script.

## Estado actual

- Código objetivo: BioOS 5.1.0; fuente canónica en `apps-script/`.
- Ingesta: webhook autenticado a través de proxy, cola durable con idempotencia, leases y finalización explícita.
- Memoria: esquema 2 con límites y dos slots de recuperación implementado en código. La NVRAM visible en Drive sigue en esquema heredado hasta ejecutar la migración aprobada.
- Cognición: registro declarativo y auditor SPADE activos. La ROM visible solo contiene prompts de orquestador, auditor, fisiólogo y somnólogo; ejecutivo, endocrinólogo y psicólogo cognitivo permanecen inactivos.
- Acciones externas: lectura de Workspace y creación de Tasks deshabilitadas por defecto y sin scopes OAuth.
- Sensores: Mobvoi primario cuando se configura; Google Fit como fallback.
- Operación: preflight de solo lectura, recuperación explícita y mantenimiento destructivo protegido por token.

## P0 — puesta en servicio controlada

1. Configurar `BIOOS_OPS_APPROVAL_TOKEN` con al menos 24 caracteres.
2. Ejecutar `getRuntimeStateSummary()` y guardar el resultado del antes.
3. Ejecutar `migrateNVRAMToCurrentSchema(token)`; no importar directamente los respaldos de 5 MB porque exceden el límite actual de 1.5 MB.
4. Ejecutar `installCanonicalV5Prompts(token)` y conservar el `snapshotId` devuelto.
5. Asociar un proyecto GCP al Apps Script para recuperar logs mediante `clasp logs`.
6. Ejecutar `healthCheckBioOS()` y `preflightDeployment()` desde el editor; corregir secretos, proxy, cola o sensores que reporten bloqueo.
7. Probar un mensaje de texto y una voz pequeña a través del proxy; confirmar job completado, memoria actualizada y respuesta Telegram.

## P1 — observabilidad y recuperación de datos

- Crear un panel mínimo: profundidad de cola, jobs fallidos, latencia, consumo LLM, último evento/sensor y generación de slot activa.
- Diseñar ETL para los respaldos NVRAM antiguos y Health Connect: deduplicar, resumir, validar procedencia e importar por lotes bajo el límite; nunca restaurar el blob completo.
- Inventariar las 11 URLs de deployment, mapear consumidores y retirar únicamente las que no tengan tráfico ni dependencias.
- Agregar smoke tests automatizados del proxy, webhook, Sheets, Drive y proveedores biométricos sin exponer datos de salud.

## P2 — cierre funcional

- Integrar `DecisionPolicy` en el orquestador antes de reactivar cualquier acción externa; exigir aprobación por efecto y auditoría de resultados.
- Si se decide usar Calendar, Gmail o Tasks, reactivar cada capacidad por separado, agregar solo su scope y repetir consentimiento/preflight.
- Completar el outcome loop: relacionar recomendación, decisión, resultado y aprendizaje con retención y borrado definidos.
- Revisar límites de memoria con datos anonimizados y pruebas de carga antes de ampliar retención.

## Criterio de finalización

Producción se considera lista cuando preflight no devuelve FAIL/WARN, NVRAM reporta esquema 2 y slots verificables, los cinco especialistas tienen prompt aprobado, el proxy supera smoke test, la cola queda a cero tras una prueba y los logs son accesibles.
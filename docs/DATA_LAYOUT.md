# Disposición de datos

Este documento describe clases y contratos, no rutas reales, identificadores o nombres de carpetas que puedan revelar la cuenta. Los IDs/configuración concretos viven en Script Properties del propietario.

| Store | Datos | Fuente de verdad | Retención/índice | Exposición permitida |
|---|---|---|---|---|
| Configuración ROM | Invariantes, política y configuración aprobada | Archivo de configuración privado | Versionado/backup con control de cambios | Nunca secretos |
| NVRAM | Memoria durable, cursores, perfil, recuperación | Drive privado del propietario | Esquema/versionado, slots de recuperación, límite de 4 MB citado por el código | Resúmenes mínimos; evitar exportar salud |
| L0 queue | Updates/job IDs, estado de procesamiento | Repositorio de jobs configurado | Idempotencia y TTL según código | No copiar payload sensible a logs |
| L1 working memory | Ventana contextual breve | NVRAM/runtime | Límite de 10 eventos según implementación | Contexto de trabajo, no historial completo |
| L2 structured memory | Diario, sueño, sesiones, métricas visuales reportadas y hechos con procedencia | Particiones estructuradas en memoria durable | Límites por partición/capacidad implementados | Consultar por tipo/ventana; conservar estado de evidencia |
| L3 semantic memory | Átomos de preferencias, planes reportados, outcomes y notas | NVRAM en Drive | Máximo 300 átomos, expiración por tipo; vector local 96D | No incluir muestras biométricas crudas |
| L4 profile | Baselines y restricciones con procedencia | Configuración/memoria durable | Actualizar solo con evidencia y confirmación aplicable | No sustituir telemetría diaria |
| Archivo Google Fit | Puntos originales de datasets y catálogo de cobertura | Drive privado | Shards gzip, checksums y cursor reanudable; cada consulta debe respetar catálogo | Nunca versionar, adjuntar a PR o indexar en proveedor externo |
| Fotos de Telegram | Entrada visual transitoria | Telegram/worker | No conservar bytes por defecto; valores extraídos pueden almacenarse como `reported` | No incluir en fixtures/documentación |

## Provenance mínima de una observación

Cada métrica consultable debe mantener como mínimo: `metric/type`, valor y unidad, timestamp de origen, zona/ventana, proveedor/origen, momento de consulta/ingesta, estado (`observed`, `reported`, `derived`, `unknown`), referencia de evidencia e indicadores de frescura/cobertura. Derivaciones deben indicar la fórmula y los insumos; si falta un insumo, no se sintetiza un valor.

## Lectura del archivo histórico

Un catálogo no es una transcripción semántica completa. Debe resolver tipo de dato, fuente, intervalos de shard, cursor/continuidad, checksum y gaps antes de leer muestras; las respuestas derivadas deben volver a indicar intervalo, cantidad y unidades. Evitar cargar el archivo entero a prompt: usar consultas estructuradas y agregaciones deterministas.

## No versionar

Tokens, URLs privadas de webhook, IDs de Drive/Apps Script, chat IDs, exportaciones de salud, datos de imágenes, backups reales o dumps de NVRAM. La configuración local de desarrollo debe estar ignorada o contener solo datos sintéticos.

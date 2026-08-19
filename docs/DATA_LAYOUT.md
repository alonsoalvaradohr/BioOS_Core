# Disposición de datos

## Runtime en la raíz de Drive

- `BioOS_ROM.json`: reglas y prompts aprobados.
- `BioOS_NVRAM.json`: estado mutable actual.
- `BioOS_Database.gsheet`: acceso a la hoja usada como repositorio L0.

Estos archivos permanecen en la carpeta de Drive llamada `BioOS_Core` para conservar compatibilidad con el runtime. Los IDs explícitos en Script Properties son preferibles a buscar por nombre.

## Datos locales no versionados

- `data/raw/health-connect/`: exportaciones originales.
- `data/backups/2026-08-18/`: copias NVRAM/ROM encontradas durante la auditoría.
- `data/legacy-config/`: matriz, roles y configuración usados por v4 pero no referenciados por v5.

No se restauró ningún respaldo automáticamente. La NVRAM actual es mucho menor que las copias históricas; antes de cualquier recuperación debe compararse el esquema, la generación y el contenido mediante herramientas que no expongan datos sensibles.

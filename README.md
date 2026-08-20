# BioOS Core

BioOS es un kernel cognitivo personal desplegado sobre Google Apps Script. Recibe eventos autenticados de Telegram, consolida telemetría y contexto en una memoria jerárquica, ejecuta agentes con contratos explícitos y conserva un registro operativo verificable.

La fuente canónica es la versión 5.1.0 ubicada en `apps-script/`. El código v4 encontrado en la carpeta original se conserva, sin intervenir, en `archive/legacy-v4/`.

## Estado

- Fuente local alineada con la deployment estable v38 y preparada como 5.1.0.
- Pruebas Node aisladas disponibles y sin acceso a Drive, Sheets, red o triggers.
- Webhook directo de Apps Script cerrado por diseño; producción requiere un proxy autenticado `workers.dev`.
- Reset destructivo eliminado. La recuperación usa slots NVRAM verificables.
- Datos biométricos, respaldos y accesos locales excluidos de Git.

## Árbol del proyecto

```text
BioOS_Core/
├── apps-script/              # Fuente canónica que publica clasp
│   ├── agents/               # Contratos y política de decisión
│   ├── core/                 # Resultados, errores, contexto y JSON estructurado
│   ├── memory/               # Outcome ledger y memoria complementaria
│   ├── ops/                  # Health check y preflight de despliegue
│   ├── qa/                   # Suite aislada y pruebas Node
│   ├── sensors/              # Contratos y proveedores biométricos
│   └── appsscript.json       # Manifiesto de Google Apps Script
├── archive/legacy-v4/        # Fuente anterior, solo referencia
├── data/
│   ├── backups/              # Respaldos históricos; fuera de Git
│   ├── legacy-config/        # Configuración v4 no usada por v5
│   └── raw/                  # Exportaciones Health Connect; fuera de Git
├── docs/                     # Arquitectura, datos y operación
├── scripts/validate.mjs      # Validación estática sin dependencias
├── .clasp.json               # Proyecto y rootDir de despliegue
└── package.json              # Comandos reproducibles
```

Los archivos `BioOS_ROM.json`, `BioOS_NVRAM.json` y `BioOS_Database.gsheet` permanecen en la raíz de Drive porque el runtime los descubre allí. No deben incluirse en Git.

## Verificación local

Requiere Node.js 20 o posterior y `clasp` autenticado.

```powershell
npm run verify
clasp status
```

`npm run verify` valida sintaxis, colisiones globales, patrones destructivos, manifiesto y las pruebas de contratos/memoria.

## Flujo de publicación

1. Ejecutar `npm run verify`.
2. Revisar `clasp status` y confirmar que solo aparecen archivos de `apps-script/`.
3. Ejecutar `clasp push`.
4. Crear una versión inmutable con una descripción útil.
5. Actualizar el deployment de producción explícitamente; no crear URLs ad hoc.
6. Ejecutar `preflightDeployment()` en Apps Script.
7. Confirmar el proxy y el webhook mediante una prueba controlada.

Los detalles están en [docs/OPERATIONS.md](docs/OPERATIONS.md), el estado y las fases pendientes en [docs/ROADMAP.md](docs/ROADMAP.md), y la arquitectura en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Seguridad y datos

Este proyecto procesa información de salud. No registre secretos, NVRAM, exportaciones de Health Connect ni accesos de Telegram en Git. Las recomendaciones generadas son apoyo informativo y no sustituyen atención médica profesional.

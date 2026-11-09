# Arquitectura

## Flujo principal

```text
Telegram
  │ X-Telegram-Bot-Api-Secret-Token
  ▼
Proxy autenticado (workers.dev)
  │ token verificado dentro del payload
  ▼
doPost → repositorio L0 → workerProcessNLP
  ▼
compilador → especialistas → auditor → orquestador
  ▼
NVRAM L1-L4 + Outcome Ledger + respuesta Telegram
```

El cerebro de runtime incluye memoria semantica L3: atomos con fuente/estado/vencimiento, vector local 96D y top-k por coseno. L1 queda como buffer de turno. Los outcomes completados solo entran con confirmacion del usuario.

Apps Script no expone al evento `doPost` las cabeceras HTTP originales. Por eso Telegram no debe apuntar directamente al deployment `/exec`: el proxy valida la cabecera secreta y entrega al script una prueba verificable. El endpoint directo permanece fail-closed.

## Capas

| Capa | Responsabilidad | Rutas principales |
|---|---|---|
| Core | Contratos, errores, contexto y parsing estructurado | `apps-script/core/` |
| Ingesta | Webhook, idempotencia, cola y workers | `03b_Net_Webhook.js`, `02b_DB_Repository.js`, `11_Net_Daemons.js` |
| Sensores | Selección y normalización de proveedores; fallback a Google Fit existente mientras Health Connect no tenga bridge | `04_Sensor_Engine.js`, `apps-script/sensors/` |
| Cognición | Compilación, especialistas, auditoría y síntesis | `05_*` a `08_*`, `apps-script/agents/` |
| Memoria | NVRAM transaccional, recuperación, recuerdos vectorizados L3 y ledger persistido | `02_Mem_Hierarchical.js`, `apps-script/memory/` |
| Operación | Boot no mutante, preflight y telemetría | `99_System_Boot.js`, `apps-script/ops/` |

## Invariantes

- El preflight es de solo lectura.
- El boot no crea triggers, no cambia webhooks y no formatea datos.
- La NVRAM se modifica mediante `mutateNVRAM` y conserva slots de recuperación verificables.
- El SRE puede diagnosticar y proponer; no aplica cambios autónomos a la ROM.
- Meta-Evolve exige aprobación explícita y snapshot recuperable.
- Las pruebas no deben tocar recursos productivos.
- No se permiten IDs de deployment ni secretos fijados en el código fuente.

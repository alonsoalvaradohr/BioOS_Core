# Roadmap BioOS Core

Estado del código fuente: 8.15.1 (`develop`, inspección local 2026-11-09). La prioridad es cerrar discrepancias entre repositorio, release, cobertura real de proveedor y consulta del segundo cerebro. Estado personal de cuenta/runtime aparece como `reported` cuando procede del usuario.

## Estado resumido

| Frente | Estado | Hecho verificable | Próximo hito |
|---|---|---|---|
| Harness de desarrollo | Implementado local/en `develop` | Contexto, política y tickets ejecutables; reglas en `AGENTS.md` | Mantener tickets y estado compacto sincronizados |
| Ingesta Telegram | Implementada en código | Proxy autenticado, webhook, cola y workers | Monitorizar entrega/atascos y reconciliar triggers del runtime |
| Google Fit REST | Implementado como ruta legacy/transitoria | Lector, diagnósticos HTTP y lector de sesiones/métricas | Medir por stream qué aporta Mi Fitness y migrar antes de retirada de Fit |
| Xiaomi → Health Connect | No implementado | No existe app/bridge Android aquí | Diseñar solo si Fit deja de ser vía suficiente |
| Memoria runtime | Parcialmente implementada | L2 estructurada, L3 reportada/vector local, L4 referencia; retención/límites | Asegurar consulta correcta en preguntas abiertas y pruebas end-to-end con runtime |
| Archivo histórico | Código implementado; ejecución en progreso según reporte usuario | Status de Telegram reportado: 16/54 fuentes, 95 páginas, 96 shards, 89.192 puntos, `RUNNING` | Dejar completar; revisar gaps y probar consultas sobre el archivo |
| Release a `main` | Pendiente de PR/revisión | `develop` está 33 commits delante de `main`, 0 detrás al inicio de esta tarea | Abrir PR; revisar CI/diff; el merge queda al propietario |
| Documentación pública/privada | Actualizada en este cambio | Portal, referencias, runbooks, Mermaid, seguridad y onboarding | Mantener al cambiar contratos o despliegues |

## Fases siguientes

### 1. Completar y auditar la copia histórica

- Mantener datos raw en Drive privado, jamás en Git o embeddings externos.
- Esperar `COMPLETE`, revisar streams con denegación o cobertura parcial y conservar el resumen de auditoría.
- Probar consultas arbitrarias (cadencia, sesiones, sueño) contra archivo con origen, unidades, fechas y cobertura.
- Confirmar que el lector RAG/consulta raw realmente usa catálogo y shards; la existencia del archivo por sí sola no resuelve la amnesia.

### 2. Enlazar recuperación y respuesta

- Mantener el texto del usuario completo desde entrada hasta síntesis.
- Seleccionar store por intención de forma comprobable; no hardcodear una pregunta puntual como única solución.
- Instrumentar `query → route → stores → records/evidence → answer`, sin registrar salud sensible en logs.
- Hacer pruebas de aceptación con preguntas diversas y casos: dato presente, store vacío, permisos, sync incompleto, ambigüedad.
- Medir citas de evidencia correctas, recall relevante, abstención correcta, falsos ceros y respuestas fuera de ruta.

### 3. Sostener fuente biométrica

- El propietario indica Mi Fitness vinculado con Google Fit; verificar cada stream/ventana en runtime.
- Consultar campos existentes sin agregar scopes innecesarios. Distinguir punto no recibido, permiso denegado, fuente vacía y atraso de sincronización.
- Investigar Health Connect y origen Mi Fitness en dispositivo antes de construir puente; mantener modelo portable de proveedor y provenance.
- Google Fit REST es transición temporal: plan de migración documentado antes de deprecación efectiva.

### 4. Ciclos y prescripciones

- AM resume vigilia del día anterior y PM resume vigilia del día actual, cada uno con su ventana explícita.
- No publicar promedio semanal, ACWR o tendencia hasta tener cobertura suficiente, al menos cuatro semanas para tendencias como exige el diseño anterior, y sesiones/resultados contrastables.
- Nunca generar RHR desde HR de ejercicio; ni entrenamiento/ritmo/macros/suplementos/sueño como certeza sin fuente.
- Mantener sistema como apoyo personal no clínico y evitar vetos/órdenes médicas deterministas sin justificación y revisión.

## Criterios de salida de la fase actual

- `/syncfit status` llega a `COMPLETE` o informa explícitamente fuentes/gaps que bloquean cobertura total.
- Una consulta genérica de historial recupera un dato raw pertinente, muestra procedencia/ventana y separa dato de usuario de proveedor.
- Casos negativos distinguen `not found`, `store unavailable`, `source denied` y `index incomplete`.
- PR `develop` → `main` revisado con checks de GitHub. No se considera release hasta que propietario hace merge y el despliegue GAS se valida aparte.

## No hacer

- No declarar Xiaomi/Health Connect enlazado por tener una ruta `health_connect` configurada.
- No llamar “memoria completa” a un backup raw sin lector ni índice operativo.
- No declarar cobertura por un `HTTP 200` vacío ni por una vista de app móvil.
- No subir archivos de salud a issues, Actions artifacts, repositorio o servicios vectoriales externos.

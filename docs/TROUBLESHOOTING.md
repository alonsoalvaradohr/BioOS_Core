# Solución de problemas

## `/doctor` responde pero muestra campos ausentes

1. Anota hora de consulta, zona temporal, ventana, campos recibidos y status por endpoint.
2. Distingue `HTTP 200 / 0 puntos` (fuente consultada sin registros para esa ventana), `401/403` (OAuth/permisos/servicio) y errores de red/servidor.
3. Compara la misma fecha/ventana en Mi Fitness y Google Fit. La app local puede mostrar datos que el API cloud no sincronizó o no expone.
4. No conviertas ausentes en cero ni repitas OAuth si el scope ya está autorizado.

## Una sesión aparece sin distancia

Las sesiones, distancia y datasets pueden tener rutas/permisos distintos. Revisa diagnóstico de sesiones y distancia por separado; autorizar `fitness.location.read` no demuestra que el API haya entregado distancia. No calcules ritmo desde pasos ni duración sin distancia.

## Sueño no aparece en histórico

Comprueba ventana local, tipo de segmento, cantidad de puntos, fuente y estado de sincronización. Un promedio semanal requiere días observados suficientes; los timestamps de sueño no deben generarse a partir del horario objetivo.

## `/syncfit` no progresa o tarda

Usa `/syncfit status`: interpreta fuentes terminadas junto con shards/puntos/páginas y fuente actual. Confirma worker programado y último avance. `0/N fuentes terminadas` puede coexistir con progreso válido en la fuente que se está paginando. Si no hay avance tras varios ciclos, conserva la evidencia y revisa permisos, ejecución del trigger y errores por fuente; no borres catálogo ni archivos para “reiniciar” sin plan de recuperación.

## Respuestas repetitivas o memoria aparentemente vacía

Confirma `/ping` (versión), luego `/memoria` y la ruta de consulta que reporta el agente. El archivo raw en Drive, memoria estructurada L2 y recuerdo semántico L3 son stores distintos: el primero no implica que cada pregunta pueda indexarlo hasta que exista catálogo/reader adecuado. Reporta pregunta exacta, salida completa, versión y evidencia; evita incluir secretos o datos privados innecesarios.

## Fallos locales

```powershell
npm run harness -- context
npm run harness -- policy
npm run check
npm test
git diff --check
```

Las pruebas locales no consultan Google Fit ni ejecutan acciones productivas. Para Apps Script, mira [operación](OPERATIONS.md); no publiques un tag como mecanismo de diagnóstico.

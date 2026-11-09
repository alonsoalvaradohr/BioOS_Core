# Roadmap BioOS - estado al 2026-11-09

Codigo local, runtime GAS y flujos externos son estados distintos. Una correccion local no significa que Telegram ya use el cambio.

## Hallazgos confirmados en el repositorio

- BioOS 8.7.1 estaba desplegado; `BIOOS_SENSOR_PROVIDER` ausente cae a `health_connect`, que solo devolvia `HEALTH_CONNECT_ANDROID_BRIDGE_NOT_INSTALLED`.
- El proyecto conserva lector OAuth REST de Google Fit y scopes. Alonso confirma que antes usaba Mobvoi/Health -> Google Fit y que Mi Fitness esta vinculado a Google Fit. Eso identifica la ruta que se debe restaurar antes de introducir otro bridge.
- L1 guarda maximo 10 eventos. Antes no habia memoria semantica L3 utilizable ni persistence adapter del outcome ledger.
- El Google Fit REST existente agrega pasos, distancia, calorias y segmentos de sueño; quita RHR inventado a partir de heart-rate general.

## Cambios locales de este ticket (aun requieren release)

1. Si `health_connect` esta seleccionado sin bridge, el motor consulta Google Fit existente como failover. Si Mobvoi falla, hace el mismo fallback. `/doctor` permite comprobar en vivo resultado, timestamp, fuente y campos.
2. L3 persiste recuerdos versionados con fuente, estado, evidencia y caducidad. NLP de BioOS promueve a recuerdos reportados planes, sintomas, carga y nutricion; las sesiones no se marcan completadas por inferencia.
3. Cada recuerdo tiene un vector local privado de 96 dimensiones (feature hashing + aliases españoles); retrieval puntúa coseno y entrega top-k al orquestador. No hay llamada a embeddings externos. No es un modelo transformer, así que sus límites de semántica dependen del solapamiento de términos y del mapa de sinónimos.
4. L3 guarda el outcome ledger mediante NVRAM. `/resultado` escribe un resultado solo con confirmacion explicita; `/recordar`, `/memoria` y `/olvidar ID` permiten controlar recuerdos.
5. L3 limita 300 recuerdos; NVRAM limita 4 MB. El registro de telemetria continua estructurado y separado de las memorias vectoriales.

## Xiaomi Watch 2 y continuidad de datos

Alonso reporta que Mi Fitness esta vinculada a Google Fit. El motor vuelve a probar esa ruta con OAuth en el deployment; todavía no se ha consultado `/doctor` después de este cambio, así que no afirmo que sus permisos y endpoint estén respondiendo.

El Xiaomi Watch 2 usa Wear OS, se vincula con Mi Fitness y sus especificaciones incluyen PPG óptico, acelerómetro, giroscopio, monitor de sueño y GNSS dual L1/L5. Xiaomi documenta sueño por fases, pulso durante sueño y resumen detallado de ejercicio en Mi Fitness. La disponibilidad de cada campo en Google Fit depende de la sincronización concreta. No derivar RHR de frecuencia cardíaca durante el ejercicio.

Google recomienda Health Connect para nuevas integraciones Android y avisa que Fit APIs se deprecian durante 2026. Por eso la ruta se resuelve en dos pasos: (a) recuperar el canal Google Fit ya enlazado y medir qué campos entrega; (b) migrar a Health Connect antes de que Fit deje de funcionar, preservando auth/procedencia e historial. No construir otro bridge mientras el existente funcione.

### Siguientes pasos verificables

1. Publicar release y consultar `/doctor`; guardar en evidencia solo fuente, antigüedad, estado y campos recibidos, sin tokens.
2. Si falla, distinguir OAuth 401/403 de endpoint 4xx/5xx y de sincronización Mi Fitness vacía. Revisar Google Cloud/API/scopes y consentimiento existente sin desenlazar el reloj.
3. Comparar un día de datos de Mi Fitness con Google Fit para pasos, distancia, calorías, sueño, pulso de ejercicio y sesión. Anotar campos que realmente llegan.
4. Planear puente Health Connect de solo lectura si Google Fit ya no sirve. En el teléfono descubrir origen Mi Fitness, deduplicar registros, conservar timestamps y autenticar subida con clave ECDSA Android Keystore más HMAC servicio-a-servicio.
5. Habilitar tendencias deportivas solo con varias semanas de entrenamiento observado y resultados confirmados por Alonso.

## Estado del segundo cerebro

El diseño y código local están en [`ADR-002`](adr/ADR-002-runtime-brain-xiaomi-healthconnect.md). Las memorias durables quedan en NVRAM/Drive; una matriz `N x 96` se forma en cada búsqueda. Tensores no son necesarios para este volumen. `/memoria` informa estado; el despliegue de 8.7.1 aún no incluye estas funciones.

## Criterios de salida

- [ ] `/doctor` obtiene métricas recientes desde Google Fit y muestra fuente/antigüedad; los campos ausentes siguen `null`.
- [ ] Mi Fitness -> Google Fit es comparado con la app y su procedencia confirmada.
- [ ] Briefing AM/PM usa recuerdo relevante sin presentar reportes como telemetría.
- [ ] `Memory_storeSemantic` persiste y recupera; el usuario puede recordar/listar/borrar.
- [ ] `/resultado` registra solo outcomes explícitamente confirmados y preserva timestamps/procedencia.
- [ ] Tendencias semanales usan al menos cuatro semanas observadas y reportan insuficiencia si falta cobertura.
- [ ] El flujo de autenticación Google Fit migra a Health Connect con permisos mínimos antes de retirarse la API Fit.
- [ ] Release tag activa un único deployment estable; `/ping` y `/doctor` verificados tras rollout.

Hasta lograrlo, los cambios locales de código no se declaran activos en Telegram ni como automatización plenamente operativa.

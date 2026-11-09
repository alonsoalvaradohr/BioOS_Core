# Roadmap BioOS - estado real al 2026-11-08

Este documento sustituye el plan de servicio de 2026-08-19. El codigo local, el runtime GAS y el canal biometrico movil son estados distintos: no se declara produccion lista por tener el codigo fuente.

## Estado confirmado

- La rama local `develop` apunta al commit compartido con `main`; el arbol estaba limpio antes de este trabajo.
- El codigo local contiene proveedores Mobvoi y Google Fit REST. No contiene un lector de Health Connect ni un puente Android para Xiaomi Watch 2 / Mi Fitness.
- La exportacion local de Health Connect contiene registros con origen Mi Fitness, por lo que el reloj y la aplicacion ya estan aportando algunos datos al telefono. Apps Script no puede leer esa base del telefono por si solo.
- Los ciclos automaticos matutino y vespertino generaban texto libre con cifras no respaldadas. El informe semanal permitia inventar ACWR/volumen y guardar el resultado del LLM como historial; el ciclo mensual podia ajustar pesos persistentes sin outcomes verificados.
- El proveedor Google Fit calculaba RHR con el promedio de `heart_rate.bpm`, que no es una medida especifica de frecuencia cardiaca en reposo.

## Cerrado en codigo local

1. Los briefings automaticos programados ahora se forman de manera determinista con la fuente, hora de consulta y campos realmente disponibles. No generan ritmo, distancia, macros, suplementos, horas de acostarse ni afirmaciones de agenda sin evidencia.
2. Se elimino el promedio de frecuencia cardiaca general del campo RHR del adaptador Google Fit.
3. Se suprimieron el ACWR semanal generado por LLM y el autoajuste mensual de pesos. Se reactivaran solo tras conectar registros de entrenamiento fechados, con origen y resultado confirmado por Alonso.
4. `/doctor`, `/reauth`, `/ping` y `/ayuda` ya no presentan Google Fit como conexion de Xiaomi ni exponen un fragmento del token OAuth.
5. La preparacion de release usa `BIOOS_CONFIG.VERSION`, exige seleccionar un solo deployment GAS y no persiste el token OAuth temporal. El workflow valida el codigo en pull requests/push y despliega solo al publicar un tag versionado `v*`.

## Bloqueador: Mi Fitness -> Health Connect -> BioOS

La exportacion muestra que hay datos Xiaomi en Health Connect, pero no existe aun la ruta continua al servidor. Google indica que Mi Fitness puede compartir datos mediante Health Connect en Android; la disponibilidad incluye pasos, distancia, energia, sesiones de ejercicio, duracion/etapas de sueno y frecuencia cardiaca durante ejercicio. Las metricas disponibles dependen de lo que la aplicacion entregue. Google Fit REST esta en retirada durante 2026, asi que no debe ser la nueva integracion de largo plazo.

Trabajo necesario para completar esa ruta:

1. Crear una app/puente Android con permisos Health Connect minimos y consentimiento visible del usuario.
2. Leer por origen `com.xiaomi.wearable`, conservar timestamp y procedencia por registro, y deduplicar sesiones/intervalos antes de resumir.
3. Enviar un resumen firmado a un endpoint autenticado. No aceptar datos biometrico-anonimos ni convertir falta de datos en cero.
4. Guardar los snapshots en un historial acotado y mostrar en `/doctor` antiguedad, fuente y campos faltantes.
5. Importar outcomes de entrenamiento confirmados por el usuario. Solo con ese historial habilitar tendencias semanales; ACWR requiere semanas de carga observada, no texto generado.

El adaptador no debe asignar RHR desde frecuencia cardiaca tomada durante ejercicio. En la exportacion revisada, los registros de RHR no estaban atribuidos a Mi Fitness; hasta encontrar una fuente RHR genuina, BioOS debe marcar RHR como no disponible.

## Endurecimiento operativo v8.7.1

- Health check de solo lectura; ya no crea/migra `Queue_NLP` ni cambia propiedades.
- El código reconcilia triggers a briefings AM/PM y desprograma auditoria semanal/meta-evolucion. La reconciliacion del runtime sigue pendiente porque `scripts.run` devuelve 403 por proyecto Cloud no compartido.
- Función de reporte integral preparada para Telegram vía Apps Script API `MYSELF`; envío pendiente: Google devuelve 403 porque el cliente OAuth y el proyecto Apps Script no comparten proyecto estándar de Cloud. No expone biometría ni secretos.
- Release actualiza los deployments web seleccionados y crea/actualiza el endpoint de ejecucion privado del propietario.
- El puente Mi Fitness/Health Connect sigue pendiente. Los sensores no se consideran operativos en vivo hasta su instalacion y verificacion.
- El briefing matutino lee intenciones recientes reportadas en L1, las distingue de una sesión verificada y explicita que el perfil basal no es telemetría del día.

## Criterios para declarar el roadmap completado

- [ ] Puente Health Connect instalado, permiso aprobado y sync Mi Fitness visible.
- [ ] `/doctor` muestra datos reales recientes, procedencia Xiaomi y antiguedad; omite RHR si no existe.
- [ ] Briefing AM/PM no inventa métricas ni recomendaciones numericas; cada valor puede rastrearse a un registro.
- [ ] Outcome ledger solo acepta confirmaciones del usuario y conserva procedencia/timestamp.
- [ ] Auditoria semanal usa al menos cuatro semanas de sesiones confirmadas; sin cobertura suficiente reporta “datos insuficientes”.
- [ ] La release tag deploya un unico deployment estable; se confirma `/ping`, `/doctor` y un mensaje real despues del rollout.
- [ ] El health check de produccion no informa WARN por sensores ni errores pendientes de VFS, permisos o proxy.

Hasta que se cumplan esos puntos, el sistema esta en endurecimiento local, no en “autonomia de produccion”.

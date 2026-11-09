# Comandos de Telegram

La lista es una referencia de interfaz, no una garantía de que todos los deployments estén al día. Confirma versión y proveedor en el runtime. Los mensajes de texto y fotos se ponen en cola y se procesan asincrónicamente.

| Comando | Qué hace | Evidencia / límite |
|---|---|---|
| `/ping` | Liveness, versión y señal de respuesta | No prueba sensores, memoria completa ni jobs programados |
| `/doctor` | Diagnóstico de proveedor, última consulta, ventanas, campos y códigos HTTP sanitizados | Sin pulso live; valores `null` siguen ausentes; permiso ≠ cobertura |
| `/memoria` | Alias de estado de memoria y telemetría disponible | No afirma que el archivo histórico esté completo |
| `/recordar <texto>` | Guarda recuerdo reportado con procedencia/expiración | No transforma una afirmación en dato observado |
| `/olvidar <id>` | Elimina el recuerdo identificado según el flujo del runtime | Confirmar el ID antes de usar |
| `/resultado <descripción>` | Guarda outcome tras confirmación explícita | No infiere que una sesión ocurrió |
| `/reauth` | Informa si un scope concreto necesita autorización | No resuelve registros ausentes o `403` de otra API |
| `/syncfit` | Inicia o reanuda copia histórica Google Fit de solo lectura a Drive | Proceso paginado/reanudable; puede tardar y encontrar huecos |
| `/syncfit status` | Muestra fuentes, shards, puntos, páginas, fuente actual, progreso y worker | Progreso es parcial hasta todas las fuentes; status proviene del runtime |
| `/syncfit pausa` | Pausa worker conservando cursor y shards confirmados | Una página ya confirmada puede quedar archivada al pausar |
| `/ayuda` | Muestra ayuda disponible en runtime | Puede diferir de este documento hasta sincronizar release |

## Consultas en lenguaje natural y fotos

Se puede preguntar sobre intervalos, sesiones, sueño o métricas sin un comando dedicado. El router debe identificar tipo de pregunta, consultar el store pertinente, conservar fuente/fecha/ventana y admitir cuando falten datos. Si una consulta basada en una imagen falla, reenvía la imagen/panel legible; el registro debe seguir marcado `reported`, separado del dato de Google Fit.

No deducir distancia, ritmo, sueño, RHR ni carga de entrenamiento a partir de pasos/calorías cuando el dato no existe. “HTTP 200, 0 puntos” indica consulta exitosa sin puntos devueltos, no un valor igual a cero.

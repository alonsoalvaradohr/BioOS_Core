# Glosario

| Término | Significado en BioOS |
|---|---|
| Abstención | Explicar qué dato/fuente falta en vez de inventar valor |
| BioOS runtime | Aplicación Apps Script/Telegram, distinta del harness de desarrollo |
| Cobertura | Streams, fechas o campos realmente consultados/archivados; debe acompañar estadísticas |
| Derived / derivado | Resultado calculado desde fuentes identificadas mediante regla explícita |
| Fit REST | APIs históricas Google Fit consultadas por OAuth; ruta transitoria anunciada para deprecación en 2026 |
| Google Fit archive | Copia read-only de datasets en shards comprimidos de Drive, con catálogo/cursor |
| Health Connect | Almacén Android de datos de salud; Apps Script cloud no puede leerlo directamente |
| L0–L4 | Capas runtime descritas en [arquitectura](ARCHITECTURE.md#memoria) |
| L1 | Buffer de trabajo reciente |
| L2 | Hechos y episodios tipados, por ejemplo sesiones/métricas con timestamp |
| L3 | Recuerdos semánticos compactos buscables por similitud; no guarda series raw |
| L4 | Baseline/perfil estable con procedencia; no sustituye lectura diaria |
| NVRAM | Nombre histórico para estado durable privado en Drive, no memoria física |
| Observed / observado | Llegó del sensor/proveedor con fuente y fecha identificadas |
| Reported / reportado | Declarado por el usuario o transcrito de imagen; no verificado por proveedor |
| RHR | Frecuencia cardiaca en reposo medida según protocolo de fuente; HR de ejercicio no es RHR |
| SNC | Sistema nervioso central; estado inferido no es diagnóstico médico |
| Shard | Segmento comprimido del archivo histórico |
| Unknown / desconocido | Dato ausente, consulta incompleta o fuente no disponible; no equivale a cero |
| Vector 96D | Vector de características hash local para retrieval L3; no transformer embedding |
| Worker | Ejecución asíncrona que procesa jobs de la cola |
| Zero-trust ingress | Entrada que autentica evento y remitente sin confiar en la URL |

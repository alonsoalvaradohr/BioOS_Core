# Documentación de BioOS Core

Esta documentación distingue **lo que implementa el repositorio**, **lo que está desplegado** y **lo que el usuario observó en una integración**. Son estados distintos. Usa fuentes y fechas concretas; no interpretes una respuesta del bot como prueba de cobertura total.

## Rutas de lectura

| Quiero… | Lee… | Tipo |
|---|---|---|
| Entender BioOS y arrancar las verificaciones | [README](../README.md) | Tutorial breve |
| Seguir la entrada de Telegram hasta la respuesta | [Arquitectura](ARCHITECTURE.md) | Explicación |
| Saber dónde quedan memoria, muestras y datos privados | [Disposición de datos](DATA_LAYOUT.md) | Referencia |
| Configurar credenciales y permisos sin exponer secretos | [Configuración y seguridad](CONFIGURATION.md) | How-to / referencia |
| Operar bot, archivo histórico o hacer release | [Operaciones](OPERATIONS.md) | Runbooks |
| Consultar comandos de Telegram | [Comandos](TELEGRAM_COMMANDS.md) | Referencia |
| Diagnosticar respuestas vacías, antigüedad o fallos | [Solución de problemas](TROUBLESHOOTING.md) | How-to |
| Ver fases y bloqueadores reales | [Roadmap](ROADMAP.md) | Estado |
| Seguir la memoria de desarrollo entre tareas | [Harness](agent-harness/README.md) y [estado](agent-harness/STATE.md) | Proceso |
| Revisar términos y abreviaturas | [Glosario](GLOSSARY.md) | Referencia |
| Entender por qué se eligió la memoria actual | [ADR-002](adr/ADR-002-runtime-brain-xiaomi-healthconnect.md) | Decisión técnica |

## Orden recomendado

1. Lee el README y comprueba Node.js 20+.
2. Ejecuta `npm run harness -- context` y `npm run harness -- policy`.
3. Lee arquitectura y operación antes de editar integraciones o despliegues.
4. Crea un ticket observable con alcance permitido/prohibido.
5. Ejecuta validaciones locales y reporta qué no fue posible observar.

## Cómo leer el estado

- **Código**: fuente versionada en una rama/commit.
- **CI**: comandos ejecutados por un workflow sobre un commit.
- **Deployment**: versión de GAS asociada a un deployment concreto.
- **Runtime**: comportamiento observado mediante respuesta o diagnóstico real.
- **Cuenta/proveedor**: datos que Google Fit o Mi Fitness efectivamente entregaron en una ventana.

Un PASS en una capa no prueba las siguientes. Los informes históricos de runtime en el harness están etiquetados `reported` cuando vienen de mensajes del propietario y pueden estar desactualizados.

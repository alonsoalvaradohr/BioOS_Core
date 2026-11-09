# Ticket BioOS

Copia a `docs/tickets/active/BIOOS-YYYYMMDD-NN.md`. Un ticket = un objetivo observable = una conversación.

## Identidad

- ID: `BIOOS-YYYYMMDD-NN`
- Título: `<acción y objeto>`
- Estado: `IN_PROGRESS`
- Modo: `DIAGNOSIS | IMPLEMENTATION | REVIEW`
- Fecha: `AAAA-MM-DD`
- Repo / rama / commit inicial: `<ruta> / <rama> / <sha>`

## Evidencia inicial

- Etiqueta (`observed | reported | derived | unknown`):
- Qué ocurre ahora, con fuente/fecha/número si existe:
- Qué debe ocurrir y cómo lo observa Alonso:
- Riesgo / reversión:

## Alcance

### Scope in

- `<archivo o patrón, ej. apps-script/sensors/**>`
- `docs/tickets/active/<ID>.md` (metadatos del ticket)

### Scope out

- `<archivo, servicio, dato real o acción excluida>`

## Criterios de aceptación

- [ ] `<resultado verificable>`

## Validación y evidencia

- Comandos ejecutados y resultado literal/resumen:
- Comandos no ejecutados y razón (escribe `NOT RUN`):
- Evidencia humana pendiente, si aplica:

## Cierre en cinco líneas

OBJETIVO: `<resultado observable>`
PUNTO: `<rama @ commit; estado de runtime si se sabe>`
VISTO: `<evidencia; no confundir código local con producción>`
CAUSA: `<confirmada, probable o unknown; ubicación>`
SIGUIENTE: `<una acción concreta>`

## Regla de parada

Después de dos intentos sin evidencia nueva o 15 minutos sin cambio concreto: parar y escribir qué información falta.

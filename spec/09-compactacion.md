# 09 · Compactación

Paquete `src/compact/`. Se invoca al principio de cada vuelta del loop, no solo cuando el usuario teclea `/compact`. Referencia: `internal/compact/`.

## Interfaz

```ts
interface CompactionStrategy {
  compact(messages: Message[]): Promise<Message[]>;
}
```

En la referencia el método devuelve `([]Message, error)`. Aquí un fallo rechaza la promesa. El loop lo atrapa, avisa y sigue con el historial previo. Una estrategia que no aplica (bajo el umbral, sin punto de corte) devuelve el mismo array.

## Corte seguro

`safeSplitPoint(messages, desired): number`

Camina hacia atrás desde `desired` hasta encontrar un índice `i` donde `messages[i]` es `user` y no contiene `tool_result`. Cortar ahí deja a cada `tool_use` con su `tool_result` del mismo lado. Si no hay frontera, devuelve `0`, y la estrategia no toca nada: un corte ingenuo produce un 400 en el API siguiente.

- `desired <= 0` → `0`
- `desired >= length` → `length` (no se descarta nada)

Todas las estrategias que tiran mensajes pasan por esta función.

## Estrategias incluidas

### NoCompaction

Default del agente y de la raíz. Devuelve el array tal cual.

### SlidingWindow

Campo `keepLast`. Si `messages.length <= keepLast`, no hace nada. Si no, corta en `safeSplitPoint(messages, length - keepLast)` y devuelve el sufijo.

`/compact sliding` usa `keepLast: 6`.

### Summarize

Campos:

- `provider`
- `threshold`: compacta solo cuando `length >= threshold`
- `keepRecent`: cuántos mensajes recientes se conservan enteros
- `instructions`: opcional. Default: resumir en concreto, conservar hechos, decisiones, paths e identificadores, sin preámbulo

Pasos:

1. Si no se llegó al umbral, devolver igual.
2. `split = safeSplitPoint(messages, length - keepRecent)`. Si es 0, devolver igual.
3. `send` al provider con un único mensaje user (instrucciones + `renderTranscript` de la parte vieja) y **sin tools**.
4. El primer bloque `text` de la respuesta es el resumen. Vacío o error de red: devolver error y el loop se queda con el historial original.
5. Sustituir la parte vieja por un mensaje user:

```
[earlier conversation summary]
<resumen>
```

6. Avisar por el sink: `[compacted N messages → summary]`.

`/compact summarize` arma una estrategia con `threshold: 0` y `keepRecent: 4`, así corre aunque el historial sea corto.

El resumen gasta tokens del mismo provider y entra en `totalUsage`.

### LoggingStrategy

Envuelve otra estrategia. Si el largo cambió y hay un path de archivo, anexa un bloque con timestamp UTC, transcript de antes y transcript de después. Un fallo de escritura se imprime y no se propaga: la compactación ya ocurrió. `withLogging(inner, path)` es el constructor corto.

La raíz no envuelve el compactor por defecto. Quien quiera comparar estrategias lo activa en el cableado.

## Comando `/compact`

| Argumento | Estrategia | Efecto sobre el compactor configurado |
|---|---|---|
| vacío | la que tenga el agente | no la cambia |
| `sliding` | ventana de 6, ad hoc | no la cambia |
| `summarize` | resumen con threshold 0, ad hoc | no la cambia |
| `none` | no-op, ad hoc | no la cambia |
| otro | mensaje de error | no toca el historial |

El resultado se escribe con `setMessages`. Se imprime `compacted: A → B messages`. Si `verbose` está on y el largo cambió, se imprime el antes/después.

Ojo: `/compact` no deja instalada la estrategia ad hoc. La siguiente vuelta del loop vuelve a usar `agent.compactor`. Cambiar el default sigue siendo una línea en el cableado.

## Tests

Equivalentes a `internal/compact/strategy_test.go`:

- `safeSplitPoint` no separa un `tool_use` de su `tool_result`.
- SlidingWindow no recorta por debajo de `keepLast` y, cuando recorta, lo hace en un user de texto.
- NoCompaction es identidad.
- Summarize bajo el umbral no llama al provider. Sobre el umbral, con mock, reemplaza el prefijo por un solo user y conserva el sufijo.
- LoggingStrategy no escribe archivo si el largo no cambió.

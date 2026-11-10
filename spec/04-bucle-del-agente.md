# 04 · Bucle del agente

Paquete `src/agent/`. Un `Agent` es una conversación: provider, registry de tools, estrategia de compactación, system prompt y la lista de mensajes. El mismo struct sirve para la raíz y para cada subagente. Referencia: `internal/agent/agent.go` y `internal/agent/diff.go`.

## Estado

| Campo | Significado | Default del constructor |
|---|---|---|
| `name` | Etiqueta. Vacío en la raíz. En research, `"research"` | `""` |
| `provider` | Backend LLM | obligatorio |
| `tools` | Registry de este agente, no necesariamente el global | obligatorio |
| `compactor` | Se llama al inicio de cada vuelta | `NoCompaction` |
| `system` | System prompt de este agente | obligatorio |
| `maxTurns` | Tope de vueltas con tools | `20`. La raíz lo pone en `50`. Research en `10` |
| `verbose` | Imprime antes/después cuando la compactación cambia el largo | `false` |
| `logPrefix` | Prefijo de las líneas `[tool]`. Research usa `"  ↳ "` | `""` |
| `quiet` | No imprime el texto del asistente (el subagente lo devuelve como string) | `false` |
| `confirm` | `(prompt, detail) => Promise<boolean>`. `null` = aprobar todo | `null` |
| `messages` | Historial. Lectura por copia o por getter; escritura por `setMessages` | `[]` |

`send(prompt)` agrega un mensaje `user` con un bloque de texto y entra al loop. Devuelve el texto final del asistente, ya recortado. El agente no interpreta `@`. La UI, antes de llamar a `send`, adjunta el archivo o la carpeta de cada referencia (capítulo 13).

Si `send` recibe `onText` y el adaptador puede streamear, cada delta de texto visible se entrega ahí y el loop no vuelve a imprimir el bloque entero. Un pensamiento no se streamea ni se imprime. Sin `onText`, o si el adaptador no streamea, el texto sale entero al cerrar la respuesta, como antes. El `Response` que entra al historial es siempre el mensaje completo.

## Una vuelta

1. `compactor.compact(messages)`. Si lanza, se registra en debug (nivel error), se avisa por el sink y se sigue con el historial anterior. Si el largo cambió: evento debug con el transcript de antes y después; si `verbose`, también se imprime.
2. `provider.send(messages, tools.definitions(), { signal, system })`. `system` es el de este agente. Si lanza, el loop termina y propaga el error. El texto ya acumulado se devuelve junto con el error para no perder lo que se alcanzó a imprimir.
3. Se agrega un mensaje `assistant` con `response.content` tal cual, incluido `providerMeta`.
4. Se recorren los bloques:
   - `text` no vacío: si el bloque está marcado como pensamiento (`providerMeta.gemini.thought === true` o `providerMeta.anthropic.thought === true`), no se imprime ni se acumula. El bloque sigue dentro del mensaje assistant, porque el adaptador tiene que reenviarlo. Cualquier otro `text` se imprime salvo que el agente sea `quiet`, y siempre se acumula en el texto final.
   - `tool_use`: se ejecuta y se arma un bloque `tool_result` con el mismo `toolUseId`.
5. Si `stopReason !== "tool_use"` o no hubo ningún `tool_use`, se sale.
6. Si hubo tools, se agrega un mensaje `user` cuyos bloques son solo los `tool_result`, y se repite.
7. Si se agotan las vueltas: error `max turns (N) reached`.

Las tools de una misma respuesta se ejecutan en serie, en el orden de los bloques. Los resultados vuelven todos en un solo mensaje user. Eso coincide con lo que Anthropic y Gemini esperan, y el adaptador de OpenAI parte ese mensaje en varios `role: "tool"`.

## Ejecutar una tool

1. Imprimir `[tool] <nombre> <input>` con el `logPrefix`.
2. Evento debug de ida (`source` = `tool` o `tool/<name>` si el agente tiene nombre), con el input completo de payload y un resumen truncado a 200 caracteres.
3. Si el nombre es `write_file`, calcular el diff (abajo). El prompt de aprobación nombra el path. Si el input no se puede parsear, el diff es vacío y el prompt genérico es `approve?`.
4. Si `confirm` existe y devuelve `false`: evento debug de warning correlacionado, y resultado `"user denied this tool call"` con `isError: true`. No se llama a la tool.
5. `registry.execute`. Se mide la duración. Evento debug de vuelta correlacionado con el de ida: info si salió bien, error si `isError`. El payload es el resultado completo.

`registry.execute` de un nombre desconocido devuelve `"unknown tool: …"` con `isError: true`. No lanza. El modelo lee el fallo y puede corregir.

## Contrato de error de las tools

`execute` devuelve `{ result: string, isError: boolean }`. Nunca lanza hacia el loop por un fallo de negocio (path inexistente, comando con exit code distinto de cero, JSON inválido). Lanzar solo sería un bug del tool. El modelo necesita el mensaje para recuperarse. Esta regla está repetida en todos los tools de la referencia y es normativa aquí.

## Diff de `write_file`

Antes de `confirm`, y solo para esa tool:

- Parsear `{ path, content }` del JSON de entrada. Si falla, no hay diff.
- Si el archivo no existe: diff unificado contra `/dev/null` (`--- /dev/null`, `+++ <path> (new file)`, líneas con prefijo `+`).
- Si existe: diff unificado con 3 líneas de contexto, etiquetas `<path> (current)` y `<path> (proposed)`.
- Si el contenido propuesto es idéntico al actual: el texto `(no changes: proposed content is identical to current file)` para que el modal igual se abra.
- Un fallo al calcular el diff degrada a prompt sin detalle, no a un rechazo automático.

El diff es presentación. La escritura real ocurre después, dentro de `write_file`, si el usuario aprueba. Negar no crea ni modifica el archivo.

## Tests que el loop ya tiene que cubrir

Tomados de `internal/agent/agent_test.go`. Todos con `MockProvider`, sin red:

- Respuesta de solo texto: una llamada, el texto vuelve, el historial queda user + assistant.
- Una tool y después texto: dos llamadas; la segunda recibe el `tool_result` con el id correcto.
- Tope de vueltas: el mock repite `tool_use` y `send` falla al llegar a `maxTurns`.
- Error del provider: se propaga, el loop no se traga la excepción.

El diff tiene sus propios tests (archivo nuevo, archivo cambiado, contenido idéntico, JSON inválido), equivalentes a `internal/agent/diff_test.go`.

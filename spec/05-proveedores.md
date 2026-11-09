# 05 · Proveedores

## Interfaz

```ts
interface Provider {
  send(messages: Message[], tools: ToolDef[], ctx?: { signal?: AbortSignal; system?: string }): Promise<Response>;
  model(): string;
  setModel(name: string): void;
}
```

Tres operaciones, igual que `internal/provider/provider.go`. `send` hace el viaje de ida y vuelta. `model` / `setModel` existen para `/model`. El contexto de cancelación viaja en el argumento (en Go es el primer parámetro `context.Context`); un Ctrl-C de la UI debe abortar la llamada HTTP en curso.

`ctx.system`, cuando viene, es el system prompt de esa llamada. El bucle lo manda siempre: es el `system` de ese agente, no el del provider. Así research comparte el objeto provider (y el acumulador de tokens) sin pisar el prompt de la raíz, aunque las dos llamadas se crucen. Si `ctx.system` no viene, el adaptador usa el system con el que fue construido. Lo usan el resumen de sesión y los tests que llaman `send` directo.

Opcional, por comprobación de tipo y no por la interfaz:

```ts
interface TokenReporter {
  totalUsage(): Usage;
  estimatedCostUsd(): number; // -1 si el modelo no está en la tabla
}
```

Subagentes que comparten el mismo objeto provider suman en el mismo acumulador. Un cambio de provider con `/provider` crea un objeto nuevo y el total vuelve a cero.

## Reglas comunes a los tres adaptadores reales

- El archivo del adaptador es el único que importa el SDK de ese vendor.
- `send` traduce `Message[]` → request nativo y la respuesta nativa → `Response`. Esas dos funciones son privadas.
- `send` rellena `usage`. Si el backend no informa caché, esos campos van en 0.
- `stopReason` es el enum de tres valores. La tabla de mapeo está más abajo. La presencia de tool calls gana sobre un finish reason genérico de "stop": si hay llamadas, el motivo es `tool_use`.
- Cada `send` escribe dos eventos debug correlacionados (`source: "provider"`): la ida con el payload de request, la vuelta con elapsed, usage y content. El payload de request incluye modelo, system, max tokens, mensajes, y de cada tool solo nombre y descripción (el schema se omite para no inflar el anillo).
- `maxTokens` de partida: 8192.
- La tabla de precios es USD por millón de tokens, local al archivo del provider. Modelo desconocido → costo `-1`, y `/tokens` muestra `(unknown model — no rate)`. Las cifras se copian de la página oficial de precios en el momento de implementar y se comentan con la URL. No se inventan.
- La caché no se cobra dos veces. Anthropic ya separa `input_tokens` de los tokens de caché, así que cada campo se multiplica por su tarifa. OpenAI incluye los cacheados dentro de `prompt_tokens`: la parte fresca es `inputTokens - cacheReadTokens` y esa parte va a la tarifa de lectura. Gemini está en [06-gemini](06-gemini.md).
- El acceso al modelo activo y al acumulador es seguro ante carreras: research puede llamar `send` mientras `/model` escribe el nombre. En TypeScript el loop raíz es una sola cadena de promesas, pero un subagente y el comando pueden cruzarse; un lock liviano o una cola bastan.

## Mapa de formas

El dominio es el de Anthropic (bloques dentro de user/assistant, system aparte). Los otros dos adaptadores son los que se tuercen.

| Concepto | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| System prompt | Campo top-level `system` | Primer mensaje `role: "system"` | `systemInstruction`. Nunca un mensaje `role: "system"` dentro de `contents` |
| Rol del asistente | `assistant` | `assistant` | `model` |
| Tool call | Bloque `tool_use` en el mensaje assistant | `tool_calls[]` en el mensaje assistant | `functionCall` como part del turno `model` |
| Tool result | Bloque `tool_result` dentro de un mensaje user | Un mensaje aparte por resultado, `role: "tool"` | `functionResponse` como part de un turno `user`. El cuerpo es un objeto JSON, no un string |
| Schema de tool | `properties` + `required` por separado | Sobre JSON Schema completo | Sobre JSON Schema completo, dentro de `functionDeclarations` |
| Stop sin tools | `end_turn` | `stop` | `STOP` |
| Stop con tools | `tool_use` | `tool_calls` | A menudo `STOP` **con** parts `functionCall`. El adaptador mira las parts, no solo el finish reason |
| Caché | Campos explícitos de creación y lectura | Solo `cached_tokens` (cuenta como lectura) | `cachedContentTokenCount` si viene (cuenta como lectura). Creación en 0 salvo que el API la separe |
| Id de la llamada | Lo asigna el API | Lo asigna el API | Puede faltar. Ver [06-gemini](06-gemini.md) |

## Anthropic

Referencia: `internal/provider/anthropic.go`.

- SDK oficial, key en `ANTHROPIC_API_KEY`.
- Modelo por defecto: `claude-opus-4-7`. Sigue publicado (legado; la ficha dice que no se retira antes del 2027-04-16). No hace falta sucesor.
- Sugerencias de `/model`: `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`. Cualquier otro id se acepta y se valida en la próxima llamada.
- Cada request lleva `thinking: { type: "adaptive" }`. Los bloques `thinking` y `redacted_thinking` no se imprimen. Se guardan como `text` con `providerMeta.anthropic.thought === true`, `kind` (`thinking` o `redacted_thinking`) y `signature` o `data`. El turno siguiente los reenvía sin modificarlos: la API rechaza una firma alterada. Un pensamiento de otro provider no se reescribe como texto visible.
- Precios del tier estándar, USD por millón, copiados de [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) el 2026-11-05. La columna de escritura es la caché de 5 minutos. La de 1 hora es más cara y no se usa: esta versión no envía `cache_control`. `input_tokens` no incluye la caché.

  | Modelo | Input | Output | Cache write (5m) | Cache read |
  |---|---|---|---|---|
  | claude-opus-4-7 / 4-6 | 5 | 25 | 6.25 | 0.50 |
  | claude-sonnet-4-6 | 3 | 15 | 3.75 | 0.30 |
  | claude-haiku-4-5 | 1 | 5 | 1.25 | 0.10 |

- El capítulo 17 describe un `cache_control` ephemeral en el system prompt. El código Go no lo envía. harto tampoco lo envía en esta versión. Encenderlo es una mejora futura; los campos de usage ya están listos para mostrarlo.

## OpenAI

Referencia: `internal/provider/openai.go`. Chat Completions, no la Responses API.

- SDK oficial, key en `OPENAI_API_KEY`.
- Modelo por defecto: `gpt-5`. La ficha de `gpt-5-codex`, revisada el 2026-11-05, lo marca como apagado y exclusivo de la Responses API. Este adaptador es Chat Completions, así que ese id no puede ser el modelo con el que arranca una llamada real. Sigue aceptado si alguien lo pide con `/model`.
- Sugerencias: `gpt-5-codex`, `gpt-5`, `gpt-5-mini`, `gpt-4o`, `gpt-4o-mini`, `o3-mini`.
- Traducción de mensajes:
  - System al frente, una sola vez.
  - Un mensaje user del dominio puede mezclar texto y varios `tool_result`. Se emite un mensaje user con el texto unido, y después un mensaje `role: "tool"` por resultado, con `tool_call_id`.
  - Un assistant con texto y tool calls es un solo mensaje assistant con `content` y `tool_calls`.
- `parameters` del tool es `{ type: "object", properties: inputSchema, required }` (required solo si la lista no está vacía).
- Finish reason `stop` → `end_turn`, `tool_calls` → `tool_use`, cualquier otra cosa (incluida lista de choices vacía) → `other`.
- Usage: `prompt_tokens` → input, `completion_tokens` → output, `prompt_tokens_details.cached_tokens` → cache read. No hay cifra de cache write.
- Precios del tier estándar, USD por millón, copiados de [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing) el 2026-11-05. `gpt-5-codex` no está en esa tabla; su fila sale de [su ficha](https://developers.openai.com/api/docs/models/gpt-5-codex). `o1` y `o3-mini` ya no están en la tabla estándar: no se les inventa tarifa y el costo estimado es `-1`.

  | Modelo | Input | Output | Cache read |
  |---|---|---|---|
  | gpt-4o | 2.50 | 10 | 1.25 |
  | gpt-4o-mini | 0.15 | 0.60 | 0.075 |
  | gpt-5 / gpt-5-codex | 1.25 | 10 | 0.125 |
  | gpt-5-mini | 0.25 | 2 | 0.025 |

## Mock

Referencia: `internal/provider/mock.go`. Obligatorio desde el primer corte del loop, porque es lo que hace testeable el resto.

- `responses: Response[]` se consumen en orden.
- `repeatLast`: si es true, agotada la lista se repite la última. Sirve para probar `maxTurns`.
- `err`: si está seteado, toda llamada rechaza con ese error y no toca la lista.
- Guarda una copia de los mensajes y de las tools de cada llamada. Los tests leen `calls()`, `sentAt(i)`, `lastSent()`.
- `model()` devuelve `modelName` o `"mock"`.
- Seguro de usar desde más de una cadena de promesas.

## Debug de payloads

`payloads.ts` no conoce SDKs. Arma el JSON pretty de request (modelo, max tokens, system, briefs de tools, mensajes) y de response (elapsed, stop reason, usage, content). Lo usan los tres adaptadores reales. El mock no tiene por qué emitir debug.

## Selección

```ts
type ProviderName = "anthropic" | "openai" | "gemini";
```

`newProvider(name, model, system)`:

| name | model vacío | key que `/provider` comprueba |
|---|---|---|
| `anthropic` | default Anthropic | `ANTHROPIC_API_KEY` |
| `openai` | `gpt-5` | `OPENAI_API_KEY` |
| `gemini` | ver [06-gemini](06-gemini.md) | `GEMINI_API_KEY` |
| otro | error con la lista de nombres | — |

Arranque: `LLM_PROVIDER` o `anthropic`. Si esa construcción falla, stderr y Anthropic.

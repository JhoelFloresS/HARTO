# 03 · Modelo de dominio

Todo el harness, fuera de los adaptadores, habla estos tipos. Viven en `src/api/types.ts` y no importan SDKs. Están tomados de `internal/api/types.go`, con un campo nuevo (`providerMeta`) exigido por Gemini.

## Roles y bloques

```ts
type Role = "user" | "assistant";

type BlockType = "text" | "tool_use" | "tool_result";

interface Block {
  type: BlockType;

  text?: string;            // text

  toolUseId?: string;       // tool_use y tool_result
  toolName?: string;        // tool_use
  toolInput?: string;       // tool_use — JSON crudo, el provider no lo reinterpreta salvo para su wire format

  toolResult?: string;      // tool_result
  isError?: boolean;        // tool_result

  // Opaco. Lo escribe y lo relee solo el provider que originó el bloque.
  // El loop solo mira dos booleanas de pensamiento: gemini.thought y anthropic.thought.
  providerMeta?: unknown;
}

interface Message {
  role: Role;
  content: Block[];
}
```

No hay rol `system` ni rol `tool` en el dominio. El system prompt es un string del agente, y cada provider lo coloca donde su API lo exige. Los resultados de tools son bloques dentro de un mensaje `user`, no un rol aparte. OpenAI y Gemini rompen esa forma en el adaptador, no en el dominio.

`hasToolResult(message)` es verdadero si algún bloque es `tool_result`. La compactación lo usa para no cortar el historial en medio de un par llamada/resultado.

## Tools

```ts
interface ToolDef {
  name: string;
  description: string;
  /** Mapa de propiedades JSON Schema (el interior de `properties`, no el objeto completo). */
  inputSchema: Record<string, unknown>;
  required: string[];
}
```

`required` va aparte del schema, igual que en la referencia. El adaptador de OpenAI y el de Gemini envuelven esto en un JSON Schema `{ type: "object", properties, required }`. El de Anthropic lo pasa como dos campos. Quien agregue un tool escribe el mapa interior, no el sobre.

Los nombres de tool deben cumplir `^[A-Za-z_][A-Za-z0-9_]*$`. Gemini rechaza guiones. El prefijo MCP `servidor_herramienta` ya cumple. Los nombres se ordenan al listar definiciones: el orden entra en el request y un orden inestable rompe la caché de prompt el día que se encienda.

## Respuesta

```ts
type StopReason = "end_turn" | "tool_use" | "other";

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

interface Response {
  content: Block[];
  stopReason: StopReason;
  usage: Usage;
}
```

El loop solo ramifica en `tool_use`. `end_turn` es "el modelo terminó". `other` cubre límite de tokens, bloqueo de seguridad, respuesta vacía, negativa. Si un provider devuelve a la vez texto y tool calls, el stop reason es `tool_use` y el texto se conserva en `content` (se imprime y además se guarda).

`Usage.add` suma campo a campo. Cada provider acumula así el total de la sesión, incluidas las llamadas de subagentes y de compactación que compartan esa instancia.

## Transcript

`renderTranscript(messages)` produce texto plano para el prompt de resumen y para el log de compactación:

```
user: <texto>
[called <tool> with <json>]
[tool result: <texto>]
assistant: ...
```

Un bloque por línea, en orden. `providerMeta` no se imprime. Esta función es la que hoy existe; convertirla en una interfaz `Renderer` (markdown, JSON) es una mejora futura, no parte del contrato actual.

## Lo que estos tipos no representan

- Imágenes, audio, citas. El ejercicio 6 del repo Go las propone; no están en el dominio.
- Deltas de streaming.
- El historial ya traducido al wire format de un vendor. Traducir es trabajo del adaptador en cada `send`, a partir de estos tipos. No se cachea el request nativo entre turnos, salvo lo que viaje dentro de `providerMeta`.

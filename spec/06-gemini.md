# 06 · Proveedor Gemini

Gemini no está en `byo-coding-agent`. Este documento es el contrato del adaptador nuevo. El loop, las tools y la UI no tienen ramas `if (gemini)`.

## Decisión de transporte

Un archivo, `src/provider/gemini.ts`, importa el SDK oficial `@google/genai`. Ningún otro archivo importa ese paquete ni menciona tipos de Gemini.

Se usa `generateContent` (respuesta completa, sin streaming). La API live, la de *interactions* y los endpoints de batch quedan fuera.

Autenticación: el SDK lee `GEMINI_API_KEY`. Si el SDK del momento también acepta `GOOGLE_API_KEY`, esa variable puede servir de respaldo, pero el aviso de `/provider` nombra `GEMINI_API_KEY`.

Modelo por defecto: `gemini-3.5-flash-lite`. Es el Flash chico de alto volumen. `gemini-3.8-flash` respondió `503` por demanda alta, y `gemini-2.5-flash` sigue rechazado para cuentas nuevas. Sugerencias de `/model`:

- `gemini-3.5-flash-lite` (default)
- `gemini-3.6-flash`
- `gemini-3.8-flash`

Cualquier otro id se acepta y falla en la próxima llamada si el API no lo conoce. Si al implementar esos ids ya fueron renombrados, se actualizan el default, la lista y este párrafo juntos. No se hardcodean ids en el dominio; viven en el adaptador y en la tabla de `knownModels`.

`maxOutputTokens`: 8192, dentro de `generationConfig`.

## Request

```
systemInstruction: { parts: [{ text: system }] }     // omitir si system está vacío
contents: [ ...turnos traducidos ]
tools: [{
  functionDeclarations: [{
    name, description,
    parametersJsonSchema: { type: "object", properties: inputSchema, required }
  }]
}]
generationConfig: { maxOutputTokens: 8192 }
```

`required` se omite del schema cuando la lista está vacía, igual que en OpenAI.

El SDK tiene dos campos de schema. `parameters` espera el schema viejo con tipos en mayúsculas (`OBJECT`, `STRING`). Se usa `parametersJsonSchema`, que acepta el JSON Schema en minúsculas que ya guarda `ToolDef`.

Si `tools` llega vacío (la compactación por resumen llama `send` con `tools = []`), no se manda el campo `tools`. Un array vacío confunde a algunos modelos y les invita a inventar una llamada.

## Traducción de mensajes (dominio → Gemini)

| Bloque del dominio | Part de Gemini |
|---|---|
| `text` | `{ text }` |
| `tool_use` | `{ functionCall: { name, args, id }, ...providerMeta.gemini }` |
| `tool_result` | `{ functionResponse: { name, id, response } }` |

Reglas:

1. `assistant` se escribe como `role: "model"`. `user` se queda en `"user"`.
2. `args` es el objeto parseado desde `toolInput`. Si el JSON es inválido, `send` falla con un error claro: el dominio promete JSON y seguir con un string crudo produce un 400 opaco.
3. `functionResponse.response` es un objeto, nunca un string. Éxito: `{ output: toolResult }`. Error (`isError`): `{ error: toolResult }`. El nombre de la función en la respuesta tiene que ser el de la llamada. El loop guarda `toolUseId` pero no el nombre en el `tool_result`; el adaptador lo recupera buscando hacia atrás el `tool_use` con ese id. Si no lo encuentra, `send` falla: Gemini rechaza una respuesta sin nombre.
4. Varios `tool_result` del mismo mensaje user siguen siendo varias parts de **un** content user. No se aplanan a mensajes separados (eso es lo que hace OpenAI).
5. Parts vacías no se envían. Un bloque text con string vacío se salta.
6. Si dos mensajes consecutivos del dominio tuvieran el mismo rol, el adaptador fusiona sus parts en un solo content. El loop de harto no los produce, pero un historial compactado o un cambio futuro no debe romper el request: Gemini exige alternancia user/model.
7. Lo que haya en `providerMeta.gemini` se vuelve a poner en la part correspondiente (`thought`, `thoughtSignature`). Si se pierde, los modelos con thinking rechazan el turno siguiente de function calling.

## Traducción de la respuesta (Gemini → dominio)

Se lee el primer candidate.

| Situación | `stopReason` | Contenido |
|---|---|---|
| Alguna part es `functionCall` | `tool_use` | Un `tool_use` por call, más los `text` que no sean pensamiento |
| `finishReason` `STOP` y solo texto | `end_turn` | Bloques `text` |
| `MAX_TOKENS`, `SAFETY`, `RECITATION`, `MALFORMED_FUNCTION_CALL`, `BLOCKLIST`, otro, o candidate ausente | `other` | El texto que haya, y si no hay texto un bloque `text` corto que diga el motivo (`gemini: SAFETY`, etc.) |

Prioridad: si hay `functionCall`, el motivo es `tool_use` aunque `finishReason` sea `STOP`. El loop no ejecutaría las tools en caso contrario.

Cada part de la respuesta que el modelo vaya a necesitar de vuelta se guarda en el bloque:

```ts
providerMeta: {
  gemini: {
    thought?: boolean;
    thoughtSignature?: string;
  }
}
```

- Una part con `thought: true` no se imprime como respuesta del asistente y no se mete en el texto final. Sí se guarda en el mensaje assistant (como bloque `text` con `providerMeta.gemini.thought = true`) para poder reenviarla. El loop actual imprime todo `text` no vacío: el adaptador marca estos bloques de forma que el loop los distinga. Mecanismo normativo: el bloque de pensamiento lleva `providerMeta.gemini.thought === true` y `text` con el pensamiento; el loop **no imprime ni acumula** un bloque `text` con esa bandera. Anthropic usa la misma forma en `providerMeta.anthropic.thought`. Es la única inspección que el loop hace de `providerMeta`, y solo para esas dos booleanas.
- `thoughtSignature` se copia tal cual, en la part que la traía (texto o function call). No se loguea en claro en el panel de debug si el payload de debug reusa el content: es un token opaco, pero no es un secreto de usuario. Puede ir al debug; no hace falta redactarlo.

### Ids de function call

El dominio exige `toolUseId` para emparejar el resultado. Gemini a veces manda `functionCall.id` y a veces no.

- Si viene `id`, se usa.
- Si no viene, el adaptador sintetiza `call_<índice>` dentro de esa respuesta (índice de la part de function call, desde 0) y lo escribe en el bloque. Al reenviar el historial manda ese mismo id.
- Los ids sintéticos tienen que ser estables entre el `tool_use` guardado y el `functionResponse` posterior. Como viven en el historial del dominio, lo son: el adaptador no los regenera en el viaje de vuelta, solo lee `toolUseId`.

Llamadas en paralelo: todas las parts `functionCall` de un candidate se convierten en varios bloques. El loop las ejecuta en serie y devuelve todos los resultados en el user siguiente. Gemini acepta varias `functionResponse` en ese turno. No hace falta un loop especial.

## Usage y costo

| Campo Gemini | Campo `Usage` |
|---|---|
| `usageMetadata.promptTokenCount` | `inputTokens` |
| `usageMetadata.candidatesTokenCount` | `outputTokens` |
| `usageMetadata.cachedContentTokenCount` | `cacheReadTokens` |
| (no hay campo equivalente de creación) | `cacheCreationTokens = 0` |
| `thoughtsTokenCount` | Se suma a `outputTokens`. En [UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata) es un campo aparte de `candidatesTokenCount`, y la página de precios cobra el thinking como output |

`promptTokenCount` incluye los tokens cacheados. El costo no los cobra dos veces: la parte fresca es `inputTokens - cacheReadTokens`, y la cacheada va a la tarifa de lectura.

Tarifas del tier estándar de pago, texto, USD por millón. Copiadas de [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) el 2026-11-05. `gemini-3.8-flash` y `gemini-3.6-flash` están en precio de introducción hasta el 2026-12-31; desde el 2027-01-01 esas filas pasan a 1.50 / 7.50 / 0.15. La estimación usa el precio vigente en esa fecha de lectura, no el posterior.

| Modelo | Input | Output (incluye thinking) | Cache read |
|---|---|---|---|
| gemini-3.5-flash-lite | 0.30 | 2.50 | 0.03 |
| gemini-3.6-flash | 0.75 | 3.75 | 0.075 |
| gemini-3.8-flash | 0.75 | 3.75 | 0.075 |

Modelo fuera de la tabla → `-1`.

## Errores

- HTTP, red, key inválida, modelo inexistente: `send` rechaza. El loop lo muestra como error de provider y no finge un `tool_result`.
- Candidate bloqueado por seguridad, con HTTP 200: no es un rechazo de `send`. Es un `Response` con `stopReason: "other"` y un texto que explica el bloqueo, para que el usuario lo vea en el scrollback.
- `MALFORMED_FUNCTION_CALL`: igual, `other`, con el texto del candidate si viene. El modelo, en el turno siguiente, puede corregir si el usuario insiste. No se reintenta solo.

## Debug

Misma pareja de eventos que Anthropic y OpenAI: `→ gemini.Send model=… msgs=… tools=…` y `← gemini.Send (elapsed in=… out=… cache=… stop=…)`. El payload pasa por `payloads.ts`, así que el debug muestra el dominio, no el JSON crudo de Gemini. Eso es intencional: `/debug show` compara providers sin aprender tres wire formats. Quien necesite el JSON nativo lo obtiene de un log temporal en el adaptador, no de un segundo sistema.

## Pruebas del adaptador

Sin red, con el cliente HTTP o el SDK sustituido por un fake inyectado en el constructor (el constructor de producción no pide cliente; un segundo argumento o una opción `client` solo visible en tests está bien):

- Texto simple → un bloque text, `end_turn`.
- Una `functionCall` sin id → `tool_use` con id sintético, y el viaje de vuelta incluye `functionResponse.name` correcto y `response.output`.
- Una `functionCall` con id → el mismo id en el `tool_result` reenviado.
- `functionCall` junto con `finishReason: "STOP"` → `tool_use`, no `end_turn`.
- Part con `thought: true` y `thoughtSignature` → el bloque queda en el historial, no en el texto devuelto al usuario, y el request siguiente reenvía la firma.
- `tool_result` con `isError` → `response.error`.
- Tools vacías → el request no incluye `functionDeclarations`.
- `SAFETY` sin texto → `other` más un bloque text explicativo.
- Usage numérico cae en los campos correctos y se acumula en `totalUsage`.

## Qué no hace este adaptador

- Context caching explícito (`cachedContents`). La lectura automática, si el API la reporta, solo se contabiliza.
- File API, imágenes, audio, code execution de Google, grounding con Google Search. Esas capacidades de Gemini no se exponen como tools mágicas; si algún día hacen falta, son tools del harness o un cambio de dominio.
- Streaming. Cuando exista, será el mismo trabajo para los tres providers (mejora futura), no un atajo solo de Gemini.

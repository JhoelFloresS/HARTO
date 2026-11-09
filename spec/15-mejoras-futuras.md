# 15 · Mejoras futuras

Inventario para no perderlo. Nada de esta lista es trabajo de la versión descrita en los specs 01–13, salvo que un plan posterior la promueva y actualice el spec del módulo.

Están mezcladas tres procedencias: lo que el propio libro dice que dejó afuera, lo que el libro documenta pero el código Go no hace, y lo que el port a TypeScript sugiere y este spec rechazó meter de una vez.

## Del código Go que el libro da por ausente y sigue ausente

El capítulo 13 y el README se escribieron antes que varios extras. Esto es lo que **sigue** sin estar en el código leído:

| Mejora | Dónde se discute | Notas para harto |
|---|---|---|
| Streaming de tokens | `exercises/en/05-streaming-responses.md`, cap. 13 | Toca `Provider`, el loop y la UI a la vez. Los tool calls no se pueden despachar hasta tener el JSON completo. Diseñar un `Chunk` (`text delta`, inicio/fin de tool, usage) y un método aparte o una interfaz `Streamer`, sin romper `send` síncrono. Los tres providers, Gemini incluido, lo harían juntos |
| Políticas de permiso | `how-to/en/add-a-permission-policy.md`, cap. 02 | La interfaz objetivo ya está en [08-permisos](08-permisos.md). Falta construirla |
| Caché de prompt explícita en Anthropic | cap. 17 | El capítulo muestra `cache_control` ephemeral en el system prompt. `anthropic.go` no lo envía. Los campos de usage ya existen. Encenderlo invalida al compactar y al cambiar tools o modelo |
| Entrada multilínea | cap. 08 y 13 | Enter envía, y el newline tiene que ser una combinación que la terminal distinga (Alt-Enter o Ctrl-J). Shift-Enter no es fiable |
| Persistir la conversación en curso | cap. 13 | `/save` y `/load` del array de mensajes. Distinto de la memoria de sesiones, que solo guarda el resumen |
| Estrategia `TokenBudget` | README, cap. 13 | Tirar mensajes viejos hasta un presupuesto. Empezar por un proxy de bytes; después, un conteo real si el provider lo ofrece |
| Alias de comandos | cap. 13 | `/quit` → `/exit`. Decidir si es otra entrada del mapa o un campo `aliases` |
| Historial de input en la TUI | cap. 13 | En harto el nivel B ya lo pide. Si el plan recorta la TUI, esto vuelve a esta lista |
| Reintento estructurado de tools | `exercises/en/01-tool-retry-on-error.md` | Contar fallos seguidos del mismo tool e input, inyectar una nota "retry i/n", cortar al llegar al máximo |
| Subagentes en Markdown | `exercises/en/02-markdown-subagents.md` | `.harto/agents/*.md` con frontmatter `name`, `description`, `tools`, `max_turns` y el cuerpo como system prompt |
| Otro backend de memoria | `exercises/en/03-pluggable-memory.md` | Anillo en memoria, un solo JSON, o SQLite. La interfaz `Store` no debería moverse |
| Render del transcript enchufable | `exercises/en/04-transcript-renderer.md` | Terminal (el actual), Markdown, JSON round-trip, más `/export` |
| Imágenes en el turno del usuario | `exercises/en/06-image-inputs.md` | Nuevo bloque en el dominio, traducción en los tres providers, `/attach`. Gemini también lo soporta; no adelantarlo solo ahí |
| Segundo subagente de revisión | cap. 13 | `read_file` + `cmd`, prompt de review. Sirve para ver si el modelo elige por la descripción |
| Tool `web_fetch` | cap. 13 y how-to | Un archivo más en `tool/`, con tope de bytes y timeout. El how-to ya trae el bosquejo |
| Sandbox del shell | cap. 13 | Contenedor o shell restringido. No es una `PermissionPolicy` |
| Skill packs y hooks | cap. 13, "lo que se vuelve Claude Code" | Archivos de skill cargados bajo demanda; callbacks pre/post tool configurados fuera del código |

## Del libro que el código Go ya hizo

No reimplementar como "futuro". Ya son alcance de harto: MCP (cap. 14), `AGENTS.md` (cap. 15), visor de tokens (cap. 16), diff de `write_file` (cap. 18), memoria de sesiones (cap. 19), tests con mock (el cap. 13 los pedía y `agent_test.go` existe), provider OpenAI.

La caché de prompt es el caso raro: el capítulo está escrito como si el cambio fuera de una línea, y el código no lo tiene. Queda en la tabla de arriba.

## Propias de harto, descartadas para esta versión

| Idea | Por qué no ahora |
|---|---|
| Context caching explícito de Gemini (`cachedContents`) | Otro ciclo de vida (crear, nombrar, invalidar). La lectura automática, si el API la reporta, ya se cuenta |
| Tools nativas de Gemini (Google Search, code execution) | Romperían la regla de que las tools son del harness. Si hacen falta, se modelan como tools locales que llaman a ese API, no como un atajo del adaptador |
| Búsqueda semántica en la memoria | `recall` es substring sobre el índice. Cambiar de store cuando duela |
| Auto-registro de tools por escaneo del directorio | Frágil en ESM. El barrel es una línea y es explícito |
| Capturar `stdout` como hace el Go | El sink es más simple y se puede testear |
| Paridad de la animación de brillo del banner | Cosmética |

## Deuda conocida de la referencia, a no copiar

- El `README.md` raíz describe un layout viejo (loop en `main.go`, sin MCP, "~600 líneas"). No usarlo como checklist. Usar `AGENTS.md` y `internal/`.
- `bash` en Go no trunca la salida y siempre llama a `sh`. harto no porta esa tool: la equivalente es `cmd` (`cmd.exe /d /s /c`) y sí trunca. Ver [07-herramientas](07-herramientas.md).
- `registerSubagents` en cada `/provider` vuelve a registrar. Funciona porque el mapa pisa. Al portarlo, no acumular listeners ni agents viejos: reemplazar.

## Cómo promover una mejora

Se edita el spec del módulo (o se añade uno), se anota la decisión si cambia una de [16-decisiones](16-decisiones.md), y recién entonces entra en un plan. Sacar un ítem de esta lista sin tocar el spec del módulo deja el código y la spec en desacuerdo.

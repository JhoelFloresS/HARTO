# 17 · Mapeo a la referencia

Índice para volver al repo Go cuando un spec no alcance. Rutas relativas a la raíz de `byo-coding-agent`.

## Código que manda

| Comportamiento en harto | Archivo Go |
|---|---|
| Cableado, prompt, provider inicial, MCP en background, resumen al salir, `AGENTS.md` | `main.go` |
| Slash commands | `commands.go` |
| Tool de delegación | `delegate.go` |
| Tipos de mensaje, transcript | `internal/api/types.go` |
| Interfaz Provider | `internal/provider/provider.go` |
| Payloads de debug | `internal/provider/payloads.go` |
| Anthropic | `internal/provider/anthropic.go` |
| OpenAI | `internal/provider/openai.go` |
| Mock | `internal/provider/mock.go` |
| Loop, denegación, llamada a tools | `internal/agent/agent.go` |
| Diff de `write_file` | `internal/agent/diff.go` |
| Registry | `internal/tool/registry.go` |
| cmd, read, write, remember, recall | `internal/tool/bash.go` (harto lo reemplaza por `cmd.exe`; no se porta `sh -c`), `readfile.go`, `writefile.go`, `remember.go`, `recall.go` |
| Corte seguro y estrategias | `internal/compact/strategy.go`, `nocompaction.go`, `slidingwindow.go`, `summarize.go`, `logging.go` |
| Research y registry de subagentes | `internal/subagent/research.go`, `registry.go` |
| Cliente y registro MCP | `internal/mcp/client.go`, `register.go` |
| Plantilla de config | `mcp.example.json` |
| Store y sesiones | `internal/memory/store.go`, `sessionfiles.go` |
| Anillo de debug | `internal/debug/debug.go` |
| TUI, aprobación, panel, banner | `internal/ui/program.go`, `input.go`, `banner.go`, `highlight.go`, `compaction.go`, `styles.go` |
| Esencia del loop sin capas | `examples/minimal/main.go` |

Tests a mirar al portar: `internal/agent/agent_test.go`, `internal/agent/diff_test.go`, `internal/tool/registry_test.go`, `internal/compact/strategy_test.go`, `internal/memory/sessionfiles_test.go`, `internal/debug/debug_test.go`, `internal/api/types_test.go`.

## Guías

| Tarea | Cómo (receta) | Por qué (capítulo) |
|---|---|---|
| Añadir un provider | `how-to/en/add-a-provider.md` | `follow_along/en/03-the-provider-interface.md` |
| Añadir una tool | `how-to/en/add-a-tool.md` | `follow_along/en/09-plug-and-play-tools.md` |
| Políticas de permiso (no implementadas) | `how-to/en/add-a-permission-policy.md` | `follow_along/en/02-the-permission-gate.md` |
| Loop | `examples/minimal/` | `follow_along/en/01-the-agent-loop.md` |
| Estado de la conversación | — | `follow_along/en/06-conversation-state.md` |
| Compactación | — | `follow_along/en/07-compaction-strategies.md` |
| Comandos | — | `follow_along/en/05-slash-commands.md` |
| Estructura de paquetes | — | `follow_along/en/10-project-structure.md` |
| Subagentes | — | `follow_along/en/11-subagents.md` |
| TUI | — | `follow_along/en/12-full-tui.md` |
| MCP | — | `follow_along/en/14-mcp-support.md` |
| AGENTS.md | — | `follow_along/en/15-agents-md.md` |
| Tokens y costo | — | `follow_along/en/16-token-viewer.md` |
| Caché de prompt (capítulo sí, código no) | — | `follow_along/en/17-prompt-caching.md` |
| Diff de escritura | — | `follow_along/en/18-diff-approval.md` |
| Memoria | — | `follow_along/en/19-agent-memory.md` |
| Huecos y ejercicios | `exercises/en/` | `follow_along/en/13-whats-next.md` |

Hay par en español bajo `how-to/es/`, `follow_along/es/` y `exercises/es/`. El contenido es el mismo.

## Docs de la referencia que no hay que obedecer al pie de la letra

| Documento | Problema |
|---|---|
| `README.md` raíz, sección "Architecture in 60 seconds" y el árbol de layout | Describen una versión anterior: el loop y el REPL dentro de `main.go`, sin `internal/agent`, sin MCP, sin memoria, "~600 líneas". El propio README, más abajo, dice que no hay tests ni MCP; el código sí tiene ambos |
| `follow_along/en/13-whats-next.md` | Lista MCP, tests, tokens y permisos ricos como si nada de eso existiera. MCP, tests del loop y el visor de tokens ya están. Las políticas de permiso no |
| `follow_along/en/17-prompt-caching.md` | El snippet de `cache_control` no está en `anthropic.go`. No hay ninguna ocurrencia de `cache_control` en el módulo |
| Capítulos 01–12, los snippets | El propio índice avisa que son pedagógicos y no coinciden línea a línea con HEAD |

Cuando un capítulo y `internal/` disientan, manda `internal/`, y este spec ya incorporó esa lectura.

## Números que el cableado Go fija y harto copia

| Parámetro | Valor |
|---|---|
| `maxTurns` del constructor | 20 |
| `maxTurns` de la raíz | 50 |
| `maxTurns` de research | 10 |
| `maxTokens` de los providers | 8192 |
| Compactor de la raíz | `NoCompaction` |
| Tools de research | solo `read_file` |
| Ventana de `/compact sliding` | 6 mensajes |
| Resumen de `/compact summarize` | threshold 0, `keepRecent` 4 |
| Sesiones en el preamble | 5 |
| Transcript máximo del resumen de cierre | 50 000 caracteres |
| Anillo de debug | 500 eventos, payload 100 KiB |
| Provider si `LLM_PROVIDER` falta o falla | `anthropic` |
| Modelo OpenAI si `LLM_MODEL` falta | `gpt-5-codex` |

Gemini no tiene número en el Go. Los suyos están solo en [06-gemini](06-gemini.md): default `gemini-3.5-flash-lite`, mismo `maxTokens` 8192.

## Lo que este mapeo no incluye

`cmd/sitegen/` genera el sitio del libro. No forma parte del harness y harto no lo porta.

# 02 · Arquitectura

## Las tres capas del harness

El libro de referencia separa el trabajo en tres capas. harto las conserva:

| Capa | Qué se toca | Ejemplos |
|---|---|---|
| Construir | El loop y las interfaces | `Agent`, `Provider`, `Tool`, `CompactionStrategy` |
| Extender | Una implementación nueva detrás de una interfaz ya cerrada | Un tool, el adaptador Gemini, un subagente |
| Configurar | Archivos que el proceso lee | `AGENTS.md`, `mcp.json`, el directorio `.harto/` |

La mayor parte del uso real cae en configurar. El spec igual detalla la capa de construir, porque sin esas costuras el resto no se entiende.

## Paquetes

El código vive en `src/`. Cada carpeta corresponde a un paquete `internal/` del Go. Los tipos del SDK de un proveedor solo pueden aparecer en el archivo de ese proveedor.

```
src/
  index.ts            cableado: prompt, provider, memoria, MCP, subagentes, UI
  commands.ts         registro de slash commands
  delegate.ts         tool delegate_<nombre>. Fuera de tool/ para no ciclar imports
  api/types.ts        Message, Block, ToolDef, Response, Usage, RenderTranscript
  provider/
    provider.ts       interfaz Provider
    payloads.ts       JSON de depuración de request/response
    anthropic.ts      único import del SDK de Anthropic
    openai.ts         único import del SDK de OpenAI. OpenRouter reutiliza ese cliente
    openrouter.ts     Chat Completions contra openrouter.ai
    gemini.ts         único import del SDK de Gemini
    mock.ts           respuestas enlatadas para tests
  tool/
    registry.ts       Tool, Registry
    register.ts       importa y registra las tools locales (el sustituto de init())
    cmd.ts
    read-file.ts
    write-file.ts
    remember.ts
    recall.ts
  compact/            NoCompaction, SlidingWindow, Summarize, LoggingStrategy
  agent/              Agent.loop, diff de write_file
  subagent/           Subagent, Registry, Research, tracker de los que están corriendo
  mcp/                cliente stdio/http y MCPTool
  memory/             Store, NoMemory, SessionFiles
  debug/              anillo de eventos
  ui/                 banner, programa de terminal, estilos, highlight
```

`api/` no importa ningún otro paquete de `src/`. El resto puede depender de `api/`. La dirección permitida:

```
ui, commands  →  agent  →  provider, tool, compact, debug, api
agent         →  (no importa subagent ni mcp)
subagent      →  agent, provider, tool
mcp           →  tool, api
tool          →  api, memory          (remember y recall)
delegate      →  subagent, api, ui
index         →  todo lo anterior     (único lugar que compone el grafo)
```

`delegate.ts` existe por el mismo motivo que `delegate.go`: `tool` no puede importar `subagent`, porque `subagent` importa `agent` y `agent` importa `tool`. El tool de delegación se construye en el cableado y se registra en el `Registry` en tiempo de ejecución.

## Puntos de extensión

Cada uno es una interfaz pequeña más una implementación por archivo. Cambiar el comportamiento por defecto es construir otro objeto en `index.ts`, no editar el loop.

| Interfaz | Métodos | Implementaciones de partida |
|---|---|---|
| `Provider` | `send`, `model`, `setModel` | Anthropic, OpenAI, Gemini, Mock |
| `Tool` | `definition`, `execute` | cmd, read_file, write_file, remember, recall, delegate_*, MCP |
| `CompactionStrategy` | `compact` | NoCompaction, SlidingWindow, Summarize, LoggingStrategy |
| `Subagent` | `name`, `description`, `run` | Research |
| `Store` | `save`, `recall`, `preamble` | NoMemory, SessionFiles |

Uso de tokens y costo **no** están en `Provider`. Quien los tenga expone `totalUsage()` y `estimatedCostUsd()`. `/tokens` y la línea de estado comprueban que el objeto los tenga. Un mock no está obligado a implementarlos.

`Confirm` tampoco es una interfaz de paquete: es un callback `(prompt, detail) => Promise<boolean>` en el agente. `null` significa aprobar todo (lo usan los subagentes). La política enchufable (`PermissionPolicy`) no está construida; el diseño objetivo está en [08-permisos](08-permisos.md) y el trabajo, en mejoras futuras.

## Cableado de arranque

Orden que debe seguir `index.ts`, equivalente a `main`:

1. Identificar el proyecto en el directorio de trabajo, antes de leer `.env`, `AGENTS.md`, `.harto/` o `mcp.json`. El harness está enfocado en desarrollo de software: mira solo ese directorio, no sube a los padres ni entra en subcarpetas. Los marcadores, en este orden, y sin repetir la tecnología si hay más de un archivo de la misma:

   | Archivo | Tecnología |
   |---|---|
   | `package.json` | Node |
   | `pom.xml` | Java (Maven) |
   | `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts` | Java (Gradle) |
   | `*.sln`, `*.csproj` | .NET |
   | `go.mod` | Go |
   | `Cargo.toml` | Rust |
   | `pyproject.toml` | Python |
   | `composer.json` | PHP |
   | `Gemfile` | Ruby |

   Si hay varias, se muestran todas en ese orden, separadas por coma: `Node, Java (Maven)`. El nombre que se muestra es el de la carpeta (`basename` del directorio real).

   Si no hay marcador y stdin es un TTY, pregunta `¿Estamos en un proyecto? (s/n)`. `s`, `si`, `sí`, `y` o `yes` siguen en ese directorio con tecnología `desconocida`. `n` o `no` piden una ruta, o vacío para cerrar el proceso con código 0. Una ruta que no es un directorio se rechaza y se vuelve a pedir. Una ruta válida se resuelve desde el directorio de la pregunta y se vuelve a identificar. Si stdin no es un TTY, no se pregunta: sin marcador se sigue con tecnología `desconocida`.

   Al aceptar, `chdir` a esa raíz. Lo que sigue lee archivos de ahí.

2. Armar el system prompt base, añadir una línea con la carpeta y la tecnología detectada, y concatenarle `AGENTS.md` si existe en el cwd. Si no existe, silencio.
3. Abrir el store de memoria en `.harto/`. Si falla, seguir sin memoria y avisar por stderr. Si abre, concatenar `preamble()` al system prompt.
4. Construir el provider inicial (`LLM_PROVIDER`, default `anthropic`; `LLM_MODEL` opcional). Si el nombre es desconocido o falta la pieza, caer a Anthropic y avisar.
5. Registrar el subagente research con el provider actual y un subconjunto de tools: solo `read_file`. Registrar `delegate_research`.
6. Crear el agente raíz: ese provider, el prompt armado, el registry completo. Compactor = no-op. `maxTurns` = 50 (el default del constructor es 20; la raíz lo sube, research usa 10).
7. Registrar el sink de debug hacia la UI.
8. Lanzar la conexión MCP en segundo plano. `mcp.json` ausente no es error. Un servidor que falle se salta; los demás siguen.
9. Instalar `confirm` del agente raíz apuntando al flujo de aprobación de la UI.
10. Al salir del proceso, si hubo mensajes: pedir al provider un párrafo + tags, `save` de esa entrada, `close` del store. Un fallo del resumen no impide el `close`.

La UI muestra `carpeta · tecnología` en el banner, bajo el subtítulo, y al inicio de la línea de estado. El color es el violeta de la interfaz.

La UI por defecto, con stdin en un TTY, es la TUI del nivel B. `HARTO_REPL=1` o un stdin que no es TTY dejan el REPL del nivel A.

Cambiar de provider a mitad de sesión reemplaza `agent.provider`, vuelve a registrar subagentes (el registry pisa por nombre) y **no** borra el historial. El acumulado de tokens vuelve a cero porque vive en el provider nuevo. El próximo `send` traduce el historial genérico al formato del backend nuevo.

## Flujo de un turno

```
usuario escribe texto
        │
        ├─ empieza con "/" ──► commands.ts (no llega al modelo)
        │
        └─ si no ──► Agent.send
                        │
                        append mensaje user (texto)
                        │
                        loop hasta maxTurns:
                          compact(historial)
                          Provider.send(historial, tool defs)
                          append mensaje assistant
                          si no hay tool_use ──► devolver texto y salir
                          por cada tool_use:
                            log + debug
                            si es write_file, calcular diff
                            confirm(prompt, detail) — si niega, tool result de error
                            Registry.execute
                          append mensaje user con los tool_result
```

El API es sin estado. El cliente reenvía el historial completo en cada `send`. Por eso importan la compactación, el orden estable de las tools y no meter relojes ni nonces en el prefijo.

## System prompt

El prompt base describe el harness en el que el modelo está corriendo (TypeScript, `src/`, specs en `spec/`), le pide concisión, le pide contestar en el idioma del usuario, y le da estas reglas de tools:

- Para actuar sobre archivos y procesos: `cmd`, `read_file`, `write_file`. Las escrituras pasan por un modal de diff. `cmd` ejecuta `cmd.exe`, no PowerShell ni Bash.
- Para investigación de solo lectura ("dónde está X", "cómo funciona Y"): preferir `delegate_research` antes que leer muchos archivos en el contexto raíz.
- `remember` con moderación (convenciones, preferencias, decisiones). `recall` si hace falta buscar más atrás. Las sesiones recientes ya vienen en el preamble; mirar ahí primero.

No se copia el prompt del repo Go: ese texto habla de `follow_along/` y de un proyecto en Go que el usuario de harto no tiene delante.

## Procesos y configuración que el harness lee

| Archivo | Obligatorio | Efecto |
|---|---|---|
| `AGENTS.md` en el cwd | no | Se añade al system prompt bajo un encabezado fijo |
| `mcp.json` en el cwd | no | Lista de servidores MCP. Puede contener secretos; no se commitea. Plantilla: `mcp.example.json` |
| `.harto/` | lo crea el proceso | `sessions/*.md` + `index.json`. No se commitea |
| `LLM_PROVIDER` | no | `anthropic` (default), `openai`, `gemini`, `openrouter` |
| `LLM_MODEL` | no | Vacío = default de ese provider |
| `HARNESS_DEBUG` | no | `1` / `true` / `yes` / `on` arranca con el panel de debug grabando |
| `HARTO_REPL` | no | `1` fuerza el REPL del nivel A aunque stdin sea un TTY |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | según el provider activo | Las lee el SDK o el adaptador. harto no las parsea para mandarlas; solo avisa en `/provider` si la variable esperada está vacía |
| `.env` en el cwd | no | Lo lee el arranque, antes de mirar `LLM_PROVIDER` y las API keys. Acepta `CLAVE=valor`, `set CLAVE=valor` y `export CLAVE=valor`. Una variable que ya está en el entorno no se pisa. No se commitea |

Los comandos y la UI están especificados en [13-comandos-debug-ui](13-comandos-debug-ui.md).

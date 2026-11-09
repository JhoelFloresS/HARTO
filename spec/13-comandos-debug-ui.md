# 13 · Comandos, debug y UI

## Slash commands

Una línea que empieza con `/` no llega al modelo. Se parte en nombre y resto (`split` en el primer espacio). Nombre desconocido: `unknown command: /x (try /help)` y se considera consumida.

Registro: mapa nombre → `{ description, usage?, run(args) }`. Se llena en un módulo, no repartido por el programa.

| Comando | Uso | Efecto |
|---|---|---|
| `/help` | | Lista ordenada. Si hay `usage`, se muestra eso en lugar de `/nombre` |
| `/provider` | `/provider [anthropic\|openai\|gemini] [model]` | Sin args: actual, lista, una línea de uso. Con args: cambia provider y, si viene el segundo token, el modelo. Avisa si la API key de ese provider no está en el entorno |
| `/model` | `/model [name]` | Sin args: modelo actual, provider entre paréntesis, sugerencias de la tabla de ese provider, y la nota de que cualquier id se valida en la próxima llamada. Con args: `setModel` |
| `/clear` | | Vacía el historial del agente raíz |
| `/tools` | | Nombre y descripción. Las que son `MCPTool` llevan `(mcp)` |
| `/subagents` | | Registrados (nombre + descripción) y, aparte, los que están corriendo, con `×N` si hay más de uno |
| `/compact` | `/compact [sliding\|summarize\|none]` | Ver [09-compactacion](09-compactacion.md) |
| `/verbose` | `/verbose [on\|off]` | Sin args, alterna. Acepta también `true/yes` y `false/no` |
| `/tokens` | | Si el provider no es `TokenReporter`, una línea diciendo que no informa uso. Si lo es: input, output, y cache write/read solo cuando alguno es > 0. Costo con 4 decimales, o `(unknown model — no rate)` si es -1 |
| `/debug` | `/debug [on\|off\|clear\|ls\|show [id]]` | Ver abajo |
| `/exit` | | Termina el proceso. El `close` de memoria tiene que correr igual (hook de salida, no solo el return del main) |

`/tokens` formatea miles con comas.

No hay alias en esta versión. `/quit` como alias de `/exit` es un ejercicio del capítulo 13, no un requisito.

## Debug

Paquete `src/debug/`. Anillo en memoria. Con la grabación apagada, registrar es un chequeo barato y no guarda nada.

```ts
type Level = "info" | "warn" | "error";

interface DebugEvent {
  id: number;             // monótono, desde 1
  correlatedId: number;   // 0 si no tiene par
  time: Date;
  source: string;         // "provider" | "tool" | "tool/research" | "compact" | …
  level: Level;
  message: string;        // una línea para el panel
  payload: string;        // opcional. Request, salida de tool, transcript
}
```

- Capacidad: 500 eventos. Al pasar, se cae el más viejo.
- Payload máximo: 100 KiB, después `\n…[truncated]`.
- `record` devuelve el id, o 0 si estaba apagado.
- Variantes: con payload, con correlación, con formato.
- `pair(id)` camina el enlace en los dos sentidos (la respuesta apunta al request; el request se busca por quien lo cita).
- `findById`, `latest` (el más reciente que tenga payload, o el último evento si ninguno tiene), `snapshot` (copia, viejo primero), `clear`.
- Un sink opcional se llama **después** de soltar el lock, para que la UI pueda pedir un snapshot sin trabarse.

Quién escribe:

| Origen | Ida | Vuelta |
|---|---|---|
| provider | modelo, cantidad de mensajes y tools, payload del request | elapsed, usage, stop, payload de la response. Error de red: nivel error, correlacionado |
| tool | nombre + input truncado a 200; payload = input completo | duración, bytes, o el error truncado. Nivel error si `isError`. Denegación del usuario: warning, sin ejecutar |
| compact | solo cuando el largo cambia, o cuando la estrategia lanza | el payload es el transcript antes/después |

`HARNESS_DEBUG` en verdad (`1`, `true`, `yes`, `on`) enciende la grabación antes de la primera llamada. `/debug` sin args alterna. `/debug clear` vacía y refresca la UI. `/debug ls` lista id, hora `HH:MM:SS.mmm`, source y mensaje, con `•` si hay payload. `/debug show` sin id muestra `latest`; con id, ese evento. Payload se imprime con resaltado si parece JSON.

## UI

Dos niveles. Los dos hablan el mismo contrato; el loop no importa la librería de terminal.

### Contrato, independiente de la librería

- `run(input) => Promise<void>`: la UI llama esto al enviar una línea. Si empieza con `/`, commands; si no, `agent.send`.
- Salida de texto: el agente, las tools y los comandos escriben en un sink (`write(line: string)`), no en `console.log` capturado. La UI añade la línea al scrollback.
- Aprobación: la promesa de `confirm` se resuelve desde el modal.
- Uso: una función `() => { usage, costUsd }` leída del provider actual (no de una variable capturada al arrancar), para que `/provider` se refleje en la línea de estado.
- Mensajes que la UI entiende además del texto: refresco de debug, toggle de debug, progreso MCP, fin de turno (error o no).

### Nivel A — REPL

Línea de lectura, banner simple, prompts de aprobación `y/n` en la misma terminal. Suficiente para probar providers, tools y memoria. No tiene panel de debug ni modal de diff: el diff, si existe, se imprime como texto antes de la pregunta.

Este nivel es el primero que debe poder correr. No es un descarte: sirve de respaldo si la TUI se rompe, y es donde corren los tests de comandos que no necesitan un terminal real.

### Nivel B — TUI

Paridad con `internal/ui/program.go`. La referencia usa Bubble Tea. harto pinta con Ink y reparte el alto con Yoga (`yoga-layout`): el scrollback crece, el panel de debug ocupa 12 filas cuando está activo, la línea de estado una, y la caja de input cuatro (borde, línea, borde, pista). Con el selector `@` abierto, esa ventana ocupa sus filas entre la línea de estado y la caja. Yoga puede encoger el panel o el selector si la terminal es más baja que esa suma. El comportamiento visible es este:

- Viewport con scrollback y seguimiento del final.
- Caja de input de una línea, con historial de flechas arriba/abajo persistido en el home del usuario (la referencia vieja lo tenía en `internal/ui/input.go`; el programa completo no lo usa — harto sí lo quiere en la TUI, porque es comportamiento visible y barato).
- Referencia `@`, el mismo gesto que el selector de archivos de Cursor. Si el token bajo el cursor empieza con `@` (inicio de línea o después de un espacio), se abre una ventana justo encima de la caja, de hasta 8 opciones. Lista archivos y carpetas del proyecto abierto: primero lo que está en la raíz, después lo de adentro. No entra en `node_modules`, `.git`, `dist`, `build`, ni en carpetas ocultas. Escribir sigue filtrando lo que va después del `@` (nombre, camino, o letras en orden). ↑↓ mueven la selección y no el historial. Enter o Tab insertan `@ruta` (con comillas si el camino tiene espacios) y un espacio, y no envían la línea. Esc cierra la ventana hasta que la consulta cambie. Sin coincidencias, Enter no envía. Al enviar, la línea que ve el usuario queda igual; el mensaje que recibe el modelo añade el contenido del archivo (hasta 32 KiB; un binario solo se nombra) o el listado de un nivel de la carpeta. Una ruta que salga del proyecto no se adjunta. El REPL no dibuja la ventana, pero adjunta igual. Código en `src/mention/mention.ts`.
- Spinner o estado "pensando" mientras el turno corre.
- Modal de aprobación con el diff resaltado (`+` verde, `-` rojo, `@@` cian).
- Panel inferior de debug de unas 12 líneas, visible solo con debug encendido. Tab mueve el foco. En foco: lista o detalle de un evento, selección con flechas.
- Línea de estado con el proyecto (`carpeta · tecnología`), los tokens de la sesión (input, output, costo si se conoce) y, mientras MCP conecta, el servidor actual y el contador.
- Banner de arranque: wordmark `HARTO` en letras de bloque, color violeta `#C084FC`, y debajo, más chico, `by topicos studes`. Bajo eso, la línea `carpeta · tecnología` del proyecto abierto. El violeta es el color de la interfaz (borde de la caja, línea de estado, prompt `❯`). El diff de aprobación no cambia: `+` verde, `-` rojo, `@@` cian. La animación de brillo del Go no se hace.

Implementación: `src/ui/tui.ts` es la máquina de estados (fase, teclas, historial, ventana del scroll). `src/ui/layout.ts` es el único import de `yoga-layout`. `src/ui/screen.ts` arma el árbol de Ink con `createElement` (el arranque no transforma JSX) y `src/ui/run-tui.ts` lo monta. Las teclas del proceso las entrega `useInput` de Ink. Con stdin en un TTY arranca este nivel; `HARTO_REPL=1`, o un stdin que no es TTY, deja el nivel A. El historial de input vive en `~/.harto_history`. Los tests montan el árbol con `renderToString` y leen ese string.

Estados: idle, running, awaiting approval. En running el input no manda otra línea (un turno a la vez en la raíz). Cancelar el turno aborta el `AbortSignal` que viaja a `send` y a las tools.

### Qué se imprime del asistente

Texto de los bloques `text`, salvo pensamientos marcados (ver Gemini). Las llamadas a tools se ven por la línea `[tool]`, no ocultas. El resultado crudo de la tool no se vuelca entero al scrollback: va al historial que ve el modelo y al payload de debug. La referencia imprime solo la línea `[tool] nombre input`, y el modelo recibe el cuerpo. harto hace lo mismo.

## Tests de comandos

No hace falta un terminal. Se invocan los handlers con un agente y un provider mock, y se captura el sink:

- `/model` sin args menciona el id actual.
- `/provider` con un nombre desconocido no reemplaza el provider.
- `/clear` deja el historial vacío.
- `/tokens` con un provider sin `TokenReporter` no lanza.
- `/debug ls` con el anillo vacío dice que está vacío.

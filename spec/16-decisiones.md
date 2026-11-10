# 16 · Decisiones

Cerradas durante el análisis, antes del plan. Reabrir una implica editar este archivo y el spec afectado en el mismo cambio.

## D1 · TypeScript sobre Node, ESM

harto se escribe en TypeScript y corre en Node. El repo ya se llama `harto` y su `package.json` apunta a `index.ts`. No se evalúa Python ni un puerto línea a línea que conserve Go.

## D2 · El layout espeja `internal/`

`src/api`, `provider`, `tool`, `compact`, `agent`, `subagent`, `mcp`, `memory`, `debug`, `ui`, más `index.ts`, `commands.ts` y `delegate.ts` en la raíz de `src/`. Sirve para leer el spec al lado del repo Go. No se aplana todo a un solo archivo, y tampoco se publica como librería.

## D3 · Los SDK no se escapan de su archivo

Anthropic, OpenAI, Gemini y el SDK de MCP se importan cada uno en un solo módulo. OpenRouter no añade un SDK: usa el cliente de Chat Completions que construye `openai.ts`, con otra URL y otra clave. El resto del programa ve `Message`, `Tool` y `Response`.

## D4 · Gemini es alcance de la primera versión, no un extra

El repo Go no lo tiene. harto sí, al mismo nivel que los otros dos providers: misma interfaz, mismo `/provider`, mismos tests de traducción con cliente falso. El diseño está en [06-gemini](06-gemini.md). No se pospone a "cuando los otros dos estén en producción".

## D5 · `providerMeta` opaco en `Block`

Gemini 2.5, con thinking y function calling, devuelve `thoughtSignature` que hay que reenviar o el turno siguiente falla. También devuelve parts de pensamiento que no son la respuesta al usuario.

El dominio gana un campo opaco que solo el adaptador de origen lee y escribe. El loop solo mira la bandera booleana de "esto es pensamiento" para no imprimirlo. No se crea un tipo `GeminiBlock` paralelo ni se guarda el JSON crudo del request fuera del historial.

Si Anthropic exige reenviar thinking blocks, usa el mismo campo, con `anthropic.thought === true`. No se añade un segundo mecanismo. El loop trata esa booleana igual que `gemini.thought`.

## D6 · Registro explícito de tools

TypeScript no corre `init()` de un archivo no importado. `src/tool/register.ts` importa las tools locales y las registra. Las que necesitan objetos de runtime (delegate, MCP) se registran desde `index.ts`. Rechazado: escanear el directorio al arrancar.

## D7 · Sink de salida, no un pipe sobre stdout

El Go reemplaza `os.Stdout` para no tocar cada `fmt.Println`. En un código nuevo eso es una trampa (tests, librerías, orden de escritura). Agente, tools y comandos reciben un escritor de líneas. La UI es la implementación principal; los tests usan un buffer.

## D8 · El shell es cmd.exe

La tool se llama `cmd` y ejecuta siempre `cmd.exe /d /s /c`. El comando viaja como un solo argumento, con el citado que exige `/s` (`windowsVerbatimArguments`). No hay rama a Bash ni a PowerShell: harto corre en Windows y el shell del agente es el de `cmd`. `/d` evita AutoRun del registro.

## D9 · Memoria en `.harto/`

Mismo diseño que `SessionFiles`, otro directorio, para poder correr los dos harnesses en el mismo cwd sin mezclar sesiones. Se gitignora.

## D10 · Errores de tool como resultados

Norma de la referencia, se mantiene: el modelo lee el fallo. El loop no tiene un canal de excepciones de negocio.

## D11 · Un turno de la raíz a la vez, subagentes sin preguntar

La UI no acepta otra línea mientras la raíz corre. Research no tiene `confirm` y solo posee `read_file`. Compartir la política interactiva con un subagente lo bloquearía esperando una tecla que la UI de la raíz no está sirviendo.

## D12 · Precios y ids de modelo son datos del adaptador

Se verifican contra la documentación del vendor al implementar. Un modelo desconocido cuesta `-1`, no una tarifa inventada. Cambiar un id default actualiza el adaptador, la tabla de `/model` y el párrafo del spec en el mismo cambio.

## D13 · La TUI se divide en dos niveles

Primero un REPL que ya habla con el agente. Después la TUI con modal, debug y línea de estado. El contrato de mensajes no depende de la librería: el agente sigue escribiendo en un sink. El nivel B usa Ink para pintar y `yoga-layout` para repartir el alto (scrollback flexible, panel de debug de 12 filas, línea de estado, caja de input). La máquina de estados vive en `src/ui/tui.ts`. El árbol de Ink está en `src/ui/screen.ts`, armado con `createElement`, porque `--experimental-strip-types` no transforma JSX. `yoga-layout` solo se importa desde `src/ui/layout.ts`. Los tests le mandan teclas al modelo y leen el string de `renderToString` de Ink, sin un PTY. Si stdin no es un TTY, o `HARTO_REPL=1`, arranca el REPL. La animación de brillo del banner no se hace. Ver [13-comandos-debug-ui](13-comandos-debug-ui.md).

## D14 · Este directorio se escribió antes del plan

El plan de implementación no está en `spec/`. Cuando exista, vive donde el plan diga (un doc de plan, issues) y enlaza aquí. No se convierte este directorio en un tablero de tareas.

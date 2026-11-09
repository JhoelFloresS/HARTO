# 14 · Procesos

Cómo se construye y cómo se cambia harto. Esto es el proceso de spec-driven development del repo, no el plan de tareas. El plan se escribe después y tiene que citar estos documentos.

## El spec manda

1. El comportamiento vive en `spec/`. El código lo realiza.
2. Un cambio de comportamiento edita primero el spec del módulo (o añade una decisión en [16-decisiones](16-decisiones.md) si cierra una disyuntiva). El mismo cambio incluye el código y los tests.
3. Si durante la implementación el spec resulta imposible o contradice otro spec, se para y se corrige el spec. No se "arregla en el código y ya se documentará".
4. Los criterios de hecho de cada documento son la definición de terminado de ese módulo. Un módulo sin sus tests no está terminado, aunque la demo manual funcione.
5. No se copia código del repo Go como texto generado a ciegas. Se porta el comportamiento descrito aquí. Cuando haya duda, se mira el archivo citado en [17-mapeo-referencia](17-mapeo-referencia.md) y, si el código y este spec discrepan, gana una actualización explícita de este spec.

## Convenciones de código

Heredadas de `AGENTS.md` de la referencia, traducidas:

- Un fallo de tool es un resultado `{ result, isError: true }`, no una excepción que mate el loop.
- Un archivo por tool, por estrategia y por subagente.
- Los tipos de un SDK solo existen en el archivo de ese adaptador. Un import de `@google/genai` fuera de `gemini.ts` es un defecto, igual que uno de Anthropic u OpenAI fuera de su archivo.
- Los comentarios explican por qué. El nombre explica qué.
- Identificadores públicos en inglés (`Provider`, `write_file`, `stopReason`), alineados con la referencia, para poder diffear el diseño. Los textos que ve el usuario pueden seguir el idioma de la sesión; los de los comandos de la referencia están en inglés y se mantienen así (`conversation cleared`, `approve?`) para no inventar una segunda interfaz.

Registro de tools: explícito en `src/tool/register.ts`. Ver [16-decisiones](16-decisiones.md).

Salida: sink inyectado. Prohibido reemplazar `process.stdout.write` como mecanismo de UI.

## Toolchain

- Node actual LTS, TypeScript en modo ESM (`"type": "module"`). Los imports relativos llevan extensión `.ts`: Node, con `--experimental-strip-types`, no reescribe `.js` a `.ts`. `allowImportingTsExtensions` está encendido porque el chequeo de tipos no emite JavaScript.
- El mismo modo solo borra tipos: no emite JavaScript que el tipo implicaba. Quedan fuera `enum`, namespaces y las propiedades de parámetro del constructor (`constructor(private readonly x: T)`). El campo se declara en la clase y se asigna en el cuerpo.
- El `package.json` que ya existe (`name: harto`, `main: index.ts`) se completa cuando el plan lo diga: script de arranque, script de test, script de chequeo de tipos. Hasta entonces este spec no fija el test runner; el plan elige uno (el criterio es poder correr los tests del loop sin red).
- Chequeo de tipos limpio es parte de terminar un módulo.
- La TUI añade `ink`, `react` y `yoga-layout`. No hay paso de compilación: la vista usa `createElement`. Ver [13-comandos-debug-ui](13-comandos-debug-ui.md).
- Variables de entorno de las keys no se commitean. `.env`, `.harto/` y `mcp.json` van al `.gitignore`. Sí se commitea `mcp.example.json`.

Arranque previsto. Las mismas variables pueden vivir en un `.env` del cwd (con o sin el prefijo `set`); el proceso lo carga solo:

```bat
npm start
```

Anthropic y OpenAI siguen disponibles con sus variables, sin recompilar.

## Tests

Obligatorios, sin red:

| Área | Qué fija |
|---|---|
| Dominio | `renderTranscript`, `hasToolResult`, suma de `Usage` |
| Registry | orden, subset, tool desconocida |
| Agent + mock | texto, tool round-trip, maxTurns, error de provider, denegación |
| Diff | archivo nuevo, cambio, idéntico, JSON malo |
| Compact | corte seguro, ventana, resumen con mock, no-op |
| Memoria | round-trip de SessionFiles en un directorio temporal, preamble, tags |
| Debug | anillo que descarta el viejo, correlación, apagado no guarda, tope de payload |
| Gemini | la lista de [06-gemini](06-gemini.md), con cliente falso |
| Comandos | los casos de [13-comandos-debug-ui](13-comandos-debug-ui.md) |

Los adaptadores de Anthropic y OpenAI se prueban con cliente falso en la misma forma (una ida de texto, una de tool call, el mapeo de stop reason). No se exige un test que pegue a la API real en CI.

## Definición de un módulo listo

- El spec de ese módulo no tiene comportamiento sin cubrir en código.
- Los tests de la tabla correspondiente pasan.
- El tipo del SDK no se escapó del archivo del adaptador.
- Un ejemplo manual del criterio de producto en [01-vision](01-vision.md), cuando el módulo ya es visible para una persona, se recorrió una vez. La TUI, el día que exista, se recorre en la terminal real: aprobar, negar, scroll, `/debug`.

## Orden sugerido para el futuro plan

No es el plan. Es el orden en el que las dependencias no se invierten, para que quien escriba el plan no empiece por la TUI.

1. Tipos de dominio y tests de transcript.
2. Mock y bucle del agente, con tests. Todavía sin UI: los tests son el cliente.
3. Registry y las tres tools de filesystem (`cmd` vía `cmd.exe`, `read_file`, `write_file`). `confirm` inyectable en el test (una función que devuelve true/false).
4. Adaptador Gemini contra cliente falso, y el cableado mínimo de provider. Gemini va aquí, no al final: es parte del alcance, y conviene chocarse con `providerMeta` antes de dar por cerrado el tipo `Block`.
5. Anthropic y OpenAI, para comprobar que el mismo loop no cambió.
6. REPL nivel A y slash commands, para poder hablar con un modelo de verdad.
7. Compactación.
8. Memoria, `remember` / `recall`, resumen al salir.
9. Subagente research y `delegate_research`.
10. Debug (el anillo puede existir antes; el panel espera a la TUI).
11. MCP.
12. TUI nivel B: modal de diff, panel de debug, línea de estado.
13. `AGENTS.md` en el prompt. Es poco código; puede adelantarse al paso 6 si el plan lo prefiere. Está al final solo porque no bloquea nada.

Cada paso del plan debería nombrar el spec que lo define y los tests que lo cierran.

## Qué no hacer en nombre del proceso

- No añadir streaming, políticas de permiso ni otro store "ya que estamos" dentro del primer plan, salvo que el plan lo saque de [15-mejoras-futuras](15-mejoras-futuras.md) como un ítem explícito.
- No partir el dominio para que Gemini sea un caso especial en el loop, más allá de la bandera de pensamiento ya especificada.
- No commitear `.harto/`, `mcp.json` ni keys.

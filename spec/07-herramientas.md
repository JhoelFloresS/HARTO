# 07 · Herramientas

## Interfaz y registro

```ts
interface Tool {
  definition(): ToolDef;
  execute(input: string, ctx: { signal?: AbortSignal }): Promise<{ result: string; isError: boolean }>;
}

class Registry {
  register(tool: Tool): void;          // pisa si el nombre ya existe
  get(name: string): Tool | undefined;
  subset(...names: string[]): Registry;
  definitions(): ToolDef[];            // ordenadas por nombre
  execute(name: string, input: string, ctx): Promise<{ result: string; isError: boolean }>;
}
```

`execute` de un nombre ausente devuelve `{ result: "unknown tool: <name>", isError: true }`.

`subset` construye otro registry solo con los nombres que existan. Los que falten se ignoran. Research se construye con `subset("read_file")`.

Hay un registry de proceso, el equivalente de `tool.Default`. Las tools locales se registran ahí desde `src/tool/register.ts`, que importa cada módulo y llama `register`. Agregar una tool = un archivo nuevo + una línea en ese barrel. No hay auto-descubrimiento: un archivo no importado no existe para el runtime de TypeScript.

Las tools que necesitan estado creado en el arranque (el delegate, las de MCP) no pasan por el barrel. Las registra `index.ts` cuando ese estado ya existe. Es el mismo criterio que `how-to/en/add-a-tool.md` parte "When init() won't work".

## Contrato de implementación

- Fallos de negocio: `{ result: mensaje, isError: true }`. Sin throw.
- Trabajos largos (shell, HTTP, MCP) respetan `signal` para que cancelar el turno mate el proceso hijo o la request.
- La descripción es lo que el modelo lee para elegir. Tiene que decir cuándo usarla, no "hace cosas con archivos".
- El input llega como JSON string. Se parsea dentro del tool. JSON inválido → `isError: true` y el mensaje del parser.
- La salida se acota. La referencia Go no acota la salida del shell ni de `read_file` (el how-to lo recomienda y el código no lo hace). harto sí, porque un archivo enorme revienta el contexto en el turno siguiente. Tope normativo: 100 KiB de texto devuelto; si se corta, se añade una línea final `\n[truncated]`. El diff de aprobación usa el contenido propuesto completo, no la versión truncada: la truncación es solo de lo que vuelve al modelo.

## `cmd`

Nombre `cmd`. Descripción: corre un comando con `cmd.exe` y devuelve stdout y stderr juntos. El shell es `cmd.exe`, no PowerShell ni Bash.

Input: `{ command: string }` requerido.

Ejecución:

- Siempre `cmd.exe /d /s /c`, con el comando como un solo argumento y `windowsVerbatimArguments` para que `cmd` aplique sus propias reglas de comillas (`/s`). `/d` no ejecuta AutoRun.
- No hay rama a `sh` ni a `powershell.exe`.
- El proceso hijo recibe el `signal`. Al abortar, el resultado es un error que dice que se canceló (`command cancelled`).
- Exit code distinto de cero: `isError: true` y el texto es la salida más `\n[exit error: …]`.
- No hay sandbox. El comando corre con los permisos del usuario. La aprobación previa es el único freno. Decirlo en la descripción no sustituye el `confirm`.

## `read_file`

Nombre `read_file`. Input `{ path: string }`. Lee el archivo como texto UTF-8. Error de sistema (no existe, es un directorio) → `isError: true` con `error.message`. Aplica el tope de 100 KiB.

## `write_file`

Nombre `write_file`. Input `{ path, content }`, ambos requeridos. Crea o pisa el archivo. Modo equivalente a `0644` donde el SO lo permita; en Windows se usa el default del runtime. Éxito: `wrote <n> bytes to <path>`.

Esta tool no muestra el diff. El diff lo calcula el agente **antes** de llamarla, y solo llega aquí si `confirm` devolvió true. No escribir el archivo dentro del cálculo del diff.

## `remember` y `recall`

Dependen del `Store` de proceso. Si nadie lo reemplazó, el store es `NoMemory`: `remember` responde `remembered.` y no persiste, `recall` responde `no matches.` El cableado de `index.ts` sustituye el store por `SessionFiles` cuando el directorio abre bien.

### remember

Input: `content` (requerido), `kind` opcional (`fact` por defecto, también `decision` o `preference`), `tags` opcional (array de strings).

Guarda una entrada con la hora actual. Respuesta `remembered.` o el error del store.

La descripción le pide al modelo usarla con moderación.

### recall

Input: `query` (requerido), `limit` opcional (default 5).

Busca en el store. Sin resultados: `no matches.` Con resultados, un listado:

```
<n> match(es) for "<query>":
- <fecha> — <contenido> [<tags>]
```

La descripción avisa de que las sesiones recientes ya están en el system prompt y que un path devuelto se puede abrir con `read_file`.

## Tools de MCP y de delegación

No viven en este paquete como archivos auto-registrados. Su contrato de cara al modelo es el mismo `Tool`. Ver [10-subagentes](10-subagentes.md) y [11-mcp](11-mcp.md).

## Tests del registry

Equivalentes a `internal/tool/registry_test.go`:

- Register + get, get de un nombre ausente.
- `definitions()` sale ordenado por nombre aunque se haya registrado al revés.
- `subset` incluye solo los pedidos y ignora nombres desconocidos.
- `execute` desconocido es error de tool, no excepción.
- Un tool que marca `isError` propaga el flag.

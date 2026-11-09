# 11 · MCP

Paquete `src/mcp/`. Un servidor MCP se conecta, se listan sus tools una vez, y cada una se registra como un `Tool` local. El loop no sabe que la llamada sale del proceso. Referencia: `internal/mcp/client.go`, `internal/mcp/register.go`, `mcp.example.json`.

## Configuración

`mcp.json` en el cwd. Si no está, `loadConfig` devuelve vacío y no es un error. Si está y el JSON es inválido, se avisa por stderr y no se conecta nada.

```json
{
  "servers": [
    {
      "name": "git",
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-git"]
    },
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    {
      "name": "github",
      "transport": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_TOKEN}" }
    }
  ]
}
```

`${VAR}` se expande en el command, los args, la URL y los valores de headers (no en las claves). Una variable ausente queda vacía. `name` es el prefijo local. `transport` es `stdio` o `http`.

El archivo puede tener secretos. Se gitignora. Se commitea `mcp.example.json` sin tokens.

## Conexión

En segundo plano, después de que la UI ya está en pantalla. El usuario puede hablar con el agente con las tools locales mientras los servidores conectan.

Por cada servidor:

1. Aviso de progreso `connecting`.
2. `stdio`: spawn de `command` + `args`, handshake por stdin/stdout. Falta `command` → fallo de ese servidor.
3. `http`: cliente HTTP con los headers inyectados en cada request. Falta `url` → fallo de ese servidor.
4. `listTools`. Si falla, se cierra el cliente y se sigue.
5. Por cada tool remota cuyo schema se entienda: registrar un `MCPTool`.
6. Aviso `connected` o `failed`.

Un servidor caído no tira el proceso. Al salir se cancela el contexto de conexión y se cierra cada cliente que haya alcanzado a abrir. Cerrar dos veces es inocuo. En stdio, cerrar mata el subproceso.

Identidad del cliente MCP: nombre `harto`, versión la del `package.json`.

## Nombre local y schema

Nombre expuesto al modelo: `<servidor>_<nombreRemoto>`. La llamada al servidor usa el nombre remoto, no el prefijo.

El schema remoto es un JSON Schema con `properties` y `required`. Se parte en el `ToolDef` del dominio (mapa interior + lista required). Un schema que no sea objeto se salta con un aviso. `properties` ausente se trata como mapa vacío, no como fallo.

## Ejecución

`MCPTool.execute` parsea el JSON de entrada a un objeto y llama `callTool` en el servidor.

- Error de transporte o de protocolo → `{ result: mensaje, isError: true }`.
- El servidor puede marcar `isError` en la respuesta MCP. Ese flag se conserva.
- El contenido se aplana a un solo string. Los bloques de texto se concatenan con saltos de línea. Un bloque que no sea texto se sustituye por `[non-text content block: <tipo>]` para que el modelo sepa que había algo. Imágenes MCP no se suben al dominio en esta versión.

## Progreso hacia la UI

```ts
type McpProgress =
  | { phase: "begin"; total: number }
  | { phase: "connecting" | "connected" | "failed"; server: string; total: number }
  | { phase: "done"; total: number };
```

La línea de estado muestra el servidor en curso y un contador mientras `begin` no haya sido cerrado por `done`. Al terminar, la línea vuelve al uso de tokens. `/tools` marca las tools MCP con el sufijo `(mcp)`.

## Librería

Se usa el cliente oficial del protocolo, `@modelcontextprotocol/client` (SDK v2). Igual que con los LLM: solo `src/mcp/client.ts` lo importa, y lo hace con `import()` dinámico para que los tests carguen sin el paquete. `register.ts` habla el `ToolDef` del dominio.

## Tests

Con un transporte falso, sin procesos reales:

- Config ausente → lista vacía.
- Un servidor que falla no impide registrar las tools de otro.
- El nombre local lleva el prefijo y `callTool` recibe el nombre remoto.
- Un schema sin `properties` usable se omite.
- Contenido mixto texto + no-texto se aplana como se dijo arriba.

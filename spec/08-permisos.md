# 08 · Permisos y aprobación

## Comportamiento normativo de esta versión

El agente raíz usa una `AllowList`: `read_file`, `recall` y `search` se ejecutan sin preguntar. El resto (`write_file`, `edit`, `cmd`, `remember`, y cualquier tool MCP) devuelve `ask` y pasa por `confirm`. Una política `null` sigue preguntando siempre, que es lo que hacen los tests que no instalan política.

`decide` corre antes del diff y antes de `confirm`. `deny` no pregunta: el tool result es `reason`, o `permission policy denied this tool call` si `reason` viene vacío. `allow` ejecuta. `ask` arma el prompt (el diff de `write_file` y de `edit`, el comando de `cmd`) y llama a `confirm` si existe. `confirm` null no pregunta: así research, que no tiene política ni `confirm`, sigue sin bloquear la UI. Un `edit` cuyo `old` no aparece una sola vez falla sin abrir el modal.

La negación no aborta el turno. Vuelve al modelo como tool result de error, texto fijo:

```
user denied this tool call
```

El modelo puede explicar, pedir otra cosa o intentar un camino distinto.

`confirm` es síncrono en apariencia (una promesa) y no llama al modelo. Quien pregunta es la UI. El detalle largo (el diff) es opcional.

## Flujo en la UI

Estados del programa: idle, running, awaiting approval.

1. El agente, durante `running`, pide aprobación.
2. Manda a la UI `{ prompt, detail, reply }` donde `reply` es una función que resuelve la promesa (en Go es un channel de un booleano).
3. La UI pasa a `awaiting approval`, muestra el prompt y, si hay detail, un modal con el diff resaltado.
4. Teclas: `y` aprueba, `n` (o Escape) niega. No se aceptan otras teclas como respuesta.
5. Al resolver, vuelve a `running` hasta que el turno termina.

El input de chat no procesa teclas mientras el modal está abierto.

## Diff

El contenido del modal para `write_file` es el string definido en [04-bucle-del-agente](04-bucle-del-agente.md). Se resalta como diff si el UI tiene highlighter; si no, se muestra en crudo. Un detail vacío usa el prompt corto `approve?` sin modal de cuerpo.

## Política

`how-to/en/add-a-permission-policy.md` describe una interfaz que el repo Go no tiene. harto la construye en `src/permission/policy.ts`.

```ts
type Decision = "ask" | "allow" | "deny";

interface PermissionPolicy {
  decide(name: string, input: string): { decision: Decision; reason: string };
}
```

- `allow`: ejecutar sin preguntar.
- `deny`: no ejecutar. `reason` es el tool result de error. Si viene vacío, el texto es `permission policy denied this tool call`. El motivo se escribe para el modelo ("path is outside the working directory"), no como un código crudo.
- `ask`: el flujo de `confirm` actual.
- Política `null`: igual que hoy, siempre `ask`. Así el cambio es compatible.

Políticas que el how-to ya bosqueja y que una versión posterior puede añadir como un archivo cada una:

| Política | Comportamiento |
|---|---|
| `AlwaysAsk` | Siempre `ask`. No es el default de la raíz |
| `AlwaysAllow` | Siempre `allow` |
| `AllowList` | `allow` si el nombre está en el conjunto; si no, `ask`. Es la política de la raíz, con `read_file`, `recall` y `search` |
| `AskOnce` | La primera vez `ask`; si el usuario dice que sí, las siguientes del mismo nombre son `allow`. Necesita un hook después del confirm, porque `decide` no puede esperar la respuesta. Estado con exclusión mutua: los subagentes comparten la política |
| `PathScoped` | Para `read_file` y `write_file`, niega paths que se salgan del cwd tras resolver `..` y symlinks. El resto lo delega a una política interna |

`decide` no pregunta, no llama al modelo y no hace red. Si hace falta un humano, devuelve `ask`.

Los subagentes no heredan la política de la raíz. Research se construye sin política y con `confirm` null.

## Amenaza que el diseño acepta

`cmd` aprobado corre en la máquina del usuario, sin contenedor. Una política de paths no cubre el shell. El sandbox es una mejora futura distinta, no una variante de `PermissionPolicy`.

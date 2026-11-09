# 08 · Permisos y aprobación

## Comportamiento normativo de esta versión

Cada tool call del agente que tenga `confirm` pasa por el usuario antes de ejecutarse. No hay lista blanca. Los subagentes se construyen con `confirm = null` y no preguntan: research solo tiene `read_file`, así que no escribe ni abre un shell.

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

## Lo que este spec no implementa

`how-to/en/add-a-permission-policy.md` describe una interfaz que el repo Go **no tiene**. harto la deja escrita para no rediseñarla después, y la marca como trabajo futuro. Hasta que se haga, `confirm` se llama siempre.

### Interfaz objetivo (no construir todavía)

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
| `AlwaysAsk` | Siempre `ask`. Es el default el día que exista la interfaz |
| `AlwaysAllow` | Siempre `allow` |
| `AllowList` | `allow` si el nombre está en el conjunto; si no, `ask` |
| `AskOnce` | La primera vez `ask`; si el usuario dice que sí, las siguientes del mismo nombre son `allow`. Necesita un hook después del confirm, porque `decide` no puede esperar la respuesta. Estado con exclusión mutua: los subagentes comparten la política |
| `PathScoped` | Para `read_file` y `write_file`, niega paths que se salgan del cwd tras resolver `..` y symlinks. El resto lo delega a una política interna |

`decide` no pregunta, no llama al modelo y no hace red. Si hace falta un humano, devuelve `ask`.

Los subagentes no heredan automáticamente la política interactiva de la raíz. Research sigue sin preguntar. El día que una política exista, se elige en el registro del subagente, no se asume.

## Amenaza que el diseño acepta

`cmd` aprobado corre en la máquina del usuario, sin contenedor. Una política de paths no cubre el shell. El sandbox es una mejora futura distinta, no una variante de `PermissionPolicy`.

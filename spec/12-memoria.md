# 12 · Memoria

Paquete `src/memory/`. La memoria no es el historial de la conversación en curso. Es lo que sobrevive al proceso: un resumen de sesiones pasadas y los hechos que el modelo decidió guardar con `remember`. Referencia: `internal/memory/store.go`, `sessionfiles.go`, capítulo 19.

## Interfaz

```ts
type EntryKind = "fact" | "decision" | "preference" | "session-summary" | string;

interface Entry {
  time: Date;
  kind: string;
  content: string;
  tags: string[];
}

interface Store {
  save(entry: Entry): Promise<void>;
  recall(query: string, limit: number): Promise<Entry[]>;
  preamble(): Promise<string>;
}
```

`close()` no está en la interfaz. No todo store tiene algo que vaciar. Lo tiene `SessionFiles`, y el cableado lo llama en el store concreto.

El store de proceso arranca en `NoMemory`: los tres métodos tienen éxito y no devuelven nada. Así las tools funcionan aunque el directorio no se pueda crear.

## SessionFiles

Directorio raíz: `.harto/` (decisión cerrada; la referencia usa `.harness/`).

```
.harto/
  index.json
  sessions/
    2026-11-05-10h09.md
```

`index.json`:

```json
{ "sessions": [ { "path": "sessions/….md", "date": "…", "summary": "…", "tags": ["…"] } ] }
```

`path` es relativo a la raíz del store.

### Arranque

Crea `sessions/` si no existe. Carga el índice. Si un path del índice ya no está en disco, se poda de memoria (la poda se escribe en el próximo flush, no hace falta reescribir el índice solo por eso). Índice ausente = lista vacía. Índice ilegible = error de apertura, y el cableado sigue sin memoria.

### save

No escribe disco. Agrega la entrada a un borrador en memoria. Si `time` no viene, se pone ahora. El borrador es barato; escribir el archivo en cada `remember` no aporta.

### preamble

Las últimas 5 sesiones del índice, de la más reciente a la más vieja, como bloque listo para concatenar al system prompt:

```
# Recent sessions (most recent first)

- 2026-11-05 10:09 (tag1, tag2): <summary>
```

Sin sesiones → string vacío. El tope de 5 existe para que un año de uso no se pague en cada turno.

### recall

Substring case-insensitive sobre el summary y los tags del índice. No abre cada archivo. Orden: más reciente primero. `limit <= 0` se trata como 5. Cada hit es una `Entry` de kind `session-summary` cuyo contenido es `[<path>] <summary>`.

No es búsqueda semántica. Cuando el índice pase de un tamaño incómodo, se cambia de store; la interfaz no promete embeddings.

### close

Si el borrador está vacío, no hace nada. Si no:

1. Arma summary, tags y cuerpo.
2. Escribe `sessions/<YYYY-MM-DD-HHhmm>.md` con la hora de inicio de la sesión (no la de cierre).
3. Añade el registro al índice y reescribe `index.json` con indentación.
4. Vacía el borrador. Una segunda llamada a `close` no duplica el archivo.

El cuerpo del markdown:

```
# <fecha de inicio>

tags: a, b

## Summary

<resumen>

## Facts
- ...

## Decisions
- ...

## Preferences
- ...

## Notes
- (kind) texto de los kinds que no son los tres de arriba
```

La entrada de kind `session-summary` se convierte en el header y en el registro del índice; no se repite como bullet. Si no hubo summary, el texto del header es `(no summary)`.

## Resumen al salir

Lo hace el cableado, no el store. Si el agente raíz tiene al menos un mensaje:

1. `renderTranscript` del historial, cortado a 50 000 caracteres con un sufijo `\n[...truncated...]`.
2. Un `send` sin tools pidiendo exactamente:

```
<un párrafo: qué se trabajó, qué se decidió, qué quedó abierto>

TAGS: tag1, tag2, tag3
```

3 a 5 tags, una palabra, minúsculas, concretos (archivos, paquetes, conceptos).

3. Se parsea por la última aparición de `TAGS:`. Si no está, todo el texto es el summary y los tags quedan vacíos. Nunca es un error.
4. `save` de una entrada `session-summary` con ese texto y esos tags.
5. `close`.

Si el `send` del resumen falla, se guarda `(summarization failed: …)` y aun así se llama a `close`, para no perder los `remember` del borrador.

## Tests

Equivalentes a `internal/memory/sessionfiles_test.go`:

- save + close escribe el markdown y el índice; un recall posterior encuentra el summary.
- preamble devuelve como máximo 5 y en orden reciente primero.
- un path del índice que no existe se ignora al buscar.
- close con borrador vacío no crea archivo.
- el parser de `TAGS:` cubre el caso feliz y el caso sin línea de tags.

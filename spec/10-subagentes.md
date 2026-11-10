# 10 · Subagentes

Paquete `src/subagent/`. Un subagente es un agente con su propio system prompt, su propio subconjunto de tools, su propio tope de vueltas y una conversación que nace y muere en una sola llamada. No comparte el historial de la raíz. Sí puede compartir el objeto provider, y entonces sus tokens se suman a la sesión.

Referencia: `internal/subagent/`, `delegate.go`.

## Interfaz

```ts
interface Subagent {
  name(): string;
  description(): string;
  run(task: string, ctx: { signal?: AbortSignal }): Promise<string>;
}
```

`run` devuelve el texto final. Un fallo del provider se propaga como rechazo; el tool de delegación lo convierte en tool result de error.

No se auto-registran. Hace falta un provider ya construido. `index.ts` los registra en el registry de proceso.

```ts
class SubagentRegistry {
  register(s: Subagent): void;
  all(): Subagent[]; // ordenados por nombre
}
```

## Research

Único subagente de partida.

- Nombre: `research`.
- Tools: `read_file` y `search`. No escribe ni abre un shell.
- `maxTurns`: 10.
- `quiet`: true. El comentario interno no se imprime en el scrollback de la raíz; el texto final vuelve como resultado del tool.
- `logPrefix`: `"  ↳ "`.
- `confirm`: null.
- System prompt: investigar la tarea, preferir pocas lecturas precisas, devolver hechos concretos (paths e identificadores literales), sin preámbulo, sin gastar llamadas de más.

Cada `run` construye un `Agent` nuevo. No hay memoria entre delegaciones.

La descripción que ve el modelo (en el tool `delegate_research`) le dice a la raíz que lo use para preguntas de código — dónde está algo, cómo funciona, qué forma tiene — y que pase una tarea concreta, no la pregunta cruda del usuario.

## Tracker

Un contador por nombre de subagentes en vuelo. `begin(name)` incrementa y devuelve una función de fin (se usa en `finally`). `/subagents` lee la foto. Tiene que ser seguro ante solapes: dos research pueden no correr a la vez hoy, pero el contador no asume eso.

## Tool `delegate_<nombre>`

Vive en `src/delegate.ts`.

Definición:

- Nombre: `delegate_` + `subagent.name()`.
- Descripción: la del subagente.
- Input: `{ task: string }` requerido.

Ejecución:

1. JSON inválido → error de tool.
2. Línea en el sink: `↳ delegating to <nombre> subagent`.
3. `run(task)`.
4. Línea: `← <nombre> subagent done (<duración>)`.
5. Si `run` rechaza: `subagent error: …` con `isError: true`.
6. Si resuelve: el texto, `isError: false`.

Al cambiar de provider se vuelven a registrar los subagentes y sus tools. El registry pisa por nombre, así que no quedan dos `delegate_research`.

## Lo que no entra

Subagentes definidos en Markdown (`.harto/agents/*.md`), el ejercicio 2 del repo Go. Es la forma correcta de tener varios sin escribir una clase por cada uno, y queda en mejoras futuras. El día que exista, el loader produce objetos que implementan esta misma interfaz; el tool de delegación no cambia.

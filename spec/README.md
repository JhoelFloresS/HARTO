# Spec de harto

Fuente de verdad del harness **harto**: un coding agent de terminal en TypeScript, construido por spec-driven development a partir de [byo-coding-agent](https://github.com/betta-tech/byo-coding-agent) (Go).

Este directorio se escribió **antes del plan de implementación**. Describe el sistema que hay que construir, las decisiones ya tomadas, el proceso para cambiarlo y lo que queda fuera. El plan de tareas sale de aquí; no lo sustituye.

## Cómo leerlo

| Doc | Para qué |
|---|---|
| [01-vision](01-vision.md) | Qué es harto, qué copia, qué cambia, qué no es |
| [02-arquitectura](02-arquitectura.md) | Capas, paquetes, cableado, flujo de un turno |
| [03-modelo-de-dominio](03-modelo-de-dominio.md) | Tipos compartidos (`Message`, `Block`, `ToolDef`, …) |
| [04-bucle-del-agente](04-bucle-del-agente.md) | El loop: compactar, llamar al modelo, despachar tools |
| [05-proveedores](05-proveedores.md) | Interfaz `Provider`, Anthropic, OpenAI, mock, tokens |
| [06-gemini](06-gemini.md) | Proveedor nuevo. No existe en el proyecto Go |
| [07-herramientas](07-herramientas.md) | `Tool`, registro, cmd / read / write / memoria |
| [08-permisos](08-permisos.md) | Aprobación, diff de `write_file`, políticas (diseño) |
| [09-compactacion](09-compactacion.md) | Estrategias y el corte seguro de historial |
| [10-subagentes](10-subagentes.md) | `Subagent`, research, tool `delegate_*` |
| [11-mcp](11-mcp.md) | Servidores MCP como tools locales |
| [12-memoria](12-memoria.md) | Store, sesiones, preamble, resumen al cerrar |
| [13-comandos-debug-ui](13-comandos-debug-ui.md) | Slash commands, log de debug, contrato de la UI |
| [14-procesos](14-procesos.md) | SDD, convenciones, build, tests, orden sugerido |
| [15-mejoras-futuras](15-mejoras-futuras.md) | Lo que el original dejó fuera y lo que harto aplaza |
| [16-decisiones](16-decisiones.md) | Decisiones cerradas (no reabrirlas en el plan) |
| [17-mapeo-referencia](17-mapeo-referencia.md) | Dónde vive cada idea en el repo Go, y qué docs están viejos |

## Regla de este directorio

Un cambio de comportamiento se escribe primero aquí. El código que contradiga un spec está mal, o el spec está mal y hay que corregirlo en el mismo cambio. Los identificadores de código (`Provider`, `StopToolUse`, `write_file`) se mantienen en inglés, igual que en la referencia, para poder comparar archivo contra archivo.

## De dónde salió

Análisis del árbol de `byo-coding-agent` en el estado leído para este spec:

- Código que manda: `main.go`, `commands.go`, `delegate.go`, `internal/`.
- Recetas de extensión: `how-to/en/` (y el par `how-to/es/`).
- El porqué de cada capa: `follow_along/en/` capítulos 00–19 (el par en `follow_along/es/` dice lo mismo).
- Huecos deliberados y ejercicios: `follow_along/en/13-whats-next.md`, `exercises/en/`.
- Esencia sin abstracciones: `examples/minimal/main.go` (~130 líneas).

`AGENTS.md` del repo Go describe el layout real. El diagrama de arquitectura del `README.md` raíz está desactualizado (sigue diciendo que el loop vive en `main.go` y que no hay MCP). El detalle está en [17-mapeo-referencia](17-mapeo-referencia.md).

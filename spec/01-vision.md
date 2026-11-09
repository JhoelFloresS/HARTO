# 01 · Visión y alcance

## Qué es harto

Un harness de coding agent para terminal. El modelo es el motor; el harness es el resto: el bucle que lo llama, las herramientas, cómo se recorta la conversación, qué puede hacer sin preguntar, y cómo habla el usuario con él.

harto es el mismo esqueleto que `byo-coding-agent`, reescrito en TypeScript para el grupo (`grupotopicos`), con una diferencia de alcance respecto al original: **Gemini es un proveedor de primera clase**, al mismo nivel que Anthropic y OpenAI. En el repo Go no hay adaptador Gemini; hay que diseñarlo, no portarlo. El contrato está en [06-gemini](06-gemini.md). El uso previsto es el desarrollo de software: al arrancar identifica el proyecto del directorio (o pide uno) y trabaja dentro de esa raíz. El detalle está en [02-arquitectura](02-arquitectura.md).

El proyecto de referencia se presenta como material de aprendizaje (~1 000 líneas bajo `internal/`), no como agente de producción. harto hereda ese carácter: legible, con costuras explícitas, intercambiable por interfaces pequeñas. No es un clon de Claude Code.

## Qué debe poder hacer la versión completa

Paridad con el comportamiento real del repo Go (no con el README viejo), más Gemini:

- Conversar con Anthropic, OpenAI o Gemini, y cambiar de proveedor o de modelo en la misma sesión (`/provider`, `/model`, o `LLM_PROVIDER` / `LLM_MODEL` al arrancar).
- Llamar tools locales: `cmd`, `read_file`, `write_file`, `remember`, `recall`.
- Pedir aprobación antes de cada tool. En `write_file`, mostrar un diff unificado antes de tocar el disco.
- Compactar el historial con estrategias intercambiables (nada, ventana, resumen, más un decorador que deja log).
- Delegar investigación de solo lectura a un subagente `research` con su propia ventana de contexto.
- Cargar `AGENTS.md` del directorio de trabajo en el system prompt.
- Recordar entre sesiones: resumen al salir, preamble al entrar, búsqueda con `recall`.
- Conectar servidores MCP por `mcp.json` (stdio y HTTP) y exponer sus tools en el mismo registro.
- Slash commands de la referencia, incluido `/tokens` y `/debug`.
- Una UI de terminal con scrollback, aprobación en modal y panel de debug.
- Tests del bucle con un proveedor mock, sin red y sin API key.

## Qué cambia respecto al Go, a propósito

Estas divergencias están cerradas en [16-decisiones](16-decisiones.md). El plan no las rediscute.

| Tema | Referencia Go | harto |
|---|---|---|
| Lenguaje | Go 1.26, módulo propio | TypeScript, Node actual, ESM |
| Auto-registro de tools | `init()` al importar el paquete | Registro explícito en un barrel. TypeScript no ejecuta un archivo que nadie importa |
| Salida hacia la UI | Secuestra `os.Stdout` con un pipe | Un sink inyectado. No se parchea `console` |
| Shell | Tool `bash`, siempre `sh -c` | Tool `cmd`, siempre `cmd.exe /d /s /c`. Sin Bash y sin PowerShell |
| Directorio de memoria | `.harness/` | `.harto/`, para no chocar si ambos corren en el mismo repo |
| Proveedores | `anthropic`, `openai` | Esos dos, más `gemini` |
| Metadatos opacos del proveedor | No hacen falta | Campo `providerMeta` en `Block`, obligatorio para las *thought signatures* de Gemini |
| System prompt | Habla del repo Go y de `follow_along/` | Habla de harto, de `spec/` y del código bajo `src/`. Sigue la regla de contestar en el idioma del usuario |

## Fuera de la versión que este spec define

No forman parte del contrato actual. Están inventariados en [15-mejoras-futuras](15-mejoras-futuras.md) para no perderlos:

- Streaming de tokens.
- Políticas de permiso más ricas que "preguntar siempre" (`AlwaysAllow`, `AllowList`, `AskOnce`, `PathScoped`). El original tampoco las tiene implementadas; solo las describe `how-to`.
- Caché de prompt activa. El capítulo 17 la explica, pero el código Go no envía `cache_control`.
- Entrada multilínea, imágenes, subagentes definidos en Markdown, reintento estructurado de tools, backends de memoria alternativos, sandbox.
- Persistencia de la conversación en curso (`/save`, `/load`). La memoria de sesiones no es eso: guarda un resumen, no el transcript completo reanudable.
- Servidor HTTP, autenticación de usuarios, multi-tenant.

## Criterio de hecho para el producto

Una persona con las API keys correspondientes puede, desde la raíz del repo:

1. Arrancar el harness y ver el prompt.
2. Cambiar a Gemini con `/provider gemini` (o arrancar ya en Gemini con `LLM_PROVIDER=gemini`).
3. Pedirle que lea un archivo, escriba otro (pasando por el diff) y ejecute un comando.
4. Ver el gasto aproximado con `/tokens`.
5. Cerrar, volver a abrir y encontrar el resumen de la sesión anterior en el contexto.
6. Correr la suite de tests sin ninguna API key.

El detalle de cada punto está en el spec del módulo correspondiente.

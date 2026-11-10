# INFO.md — Sobre el proyecto `harto`

## ¿Qué es `harto`?

**harto** es un *harness* de coding agent para terminal desarrollado en **TypeScript** (Node.js >= 22) para el grupo **grupotopicos**. Su propósito es servir como un entorno autónomo e interactivo donde un modelo de lenguaje (LLM) actúa como asistente de programación dentro de un repositorio de código.

El proyecto está inspirado en la arquitectura de `byo-coding-agent`, pero reescrito completamente en TypeScript y adaptado para soportar múltiples proveedores de LLM de primera clase:
- **Anthropic** (Claude)
- **OpenAI** (GPT)
- **Gemini** (Google GenAI)

---

## Características Principales

1. **Soporte Multi-proveedor**: Capacidad de cambiar dinámicamente entre Anthropic, OpenAI y Gemini mediante comandos como `/provider` y `/model` o variables de entorno (`LLM_PROVIDER`, `LLM_MODEL`).
2. **Herramientas Locales (Tools)**:
   - `cmd`: Ejecución de comandos en terminal (usando `cmd.exe` en Windows).
   - `read_file`: Lectura de archivos.
   - `write_file`: Escritura de archivos (con previsualización de diff unificado y aprobación previa).
   - `remember` / `recall`: Sistema de memoria persistente entre sesiones.
3. **Subagentes**: Delegación de tareas de investigación de solo lectura (`research`) con su propia ventana de contexto.
4. **Compactación de Historial**: Estrategias para gestionar el tamaño del contexto de la conversación.
5. **Integración MCP**: Conexión con servidores Model Context Protocol (vía `mcp.json`) para ampliar dinámicamente las herramientas disponibles.
6. **Interfaz de Terminal (UI)**: Construida con **Ink** (React para terminal), que incluye scrollback, modales de aprobación y panel de debug.
7. **Memoria de Sesiones**: Almacenamiento local en `.harto/` para recordar contexto entre ejecuciones.

---

## Estructura del Repositorio

- `src/`: Código fuente principal en TypeScript (agente, proveedores, herramientas, UI, memoria, MCP).
- `spec/`: Especificaciones técnicas detalladas del diseño y arquitectura (17 documentos que van desde la visión general hasta decisiones de diseño).
- `package.json`: Configuración y dependencias del proyecto.

---

## Comandos Útiles

- **Iniciar el agente:**
  ```bash
  npm start
  ```
- **Ejecutar tests:**
  ```bash
  npm test
  ```
- **Verificación de tipos:**
  ```bash
  npm run typecheck
  ```

import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

export interface Project {
  root: string;
  folder: string;
  technology: string;
}

export interface ProjectIo {
  ask(prompt: string): Promise<string>;
  write(line: string): void;
}

const namedMarkers: Array<{ file: string; technology: string }> = [
  { file: "package.json", technology: "Node" },
  { file: "pom.xml", technology: "Java (Maven)" },
  { file: "build.gradle", technology: "Java (Gradle)" },
  { file: "build.gradle.kts", technology: "Java (Gradle)" },
  { file: "settings.gradle", technology: "Java (Gradle)" },
  { file: "settings.gradle.kts", technology: "Java (Gradle)" },
  { file: "go.mod", technology: "Go" },
  { file: "Cargo.toml", technology: "Rust" },
  { file: "pyproject.toml", technology: "Python" },
  { file: "composer.json", technology: "PHP" },
  { file: "Gemfile", technology: "Ruby" },
];

const yesAnswers = new Set(["s", "si", "sí", "y", "yes"]);
const noAnswers = new Set(["n", "no"]);

/** Markers in this directory only. `null` when none of them are present. */
export function detectProject(dir: string): Project | null {
  const names = new Set(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.toLowerCase()),
  );
  const technologies: string[] = [];
  const add = (technology: string) => {
    if (!technologies.includes(technology)) technologies.push(technology);
  };
  for (const marker of namedMarkers) {
    if (names.has(marker.file.toLowerCase())) add(marker.technology);
  }
  for (const name of names) {
    if (name.endsWith(".sln") || name.endsWith(".csproj")) add(".NET");
  }
  if (technologies.length === 0) return null;
  return describe(dir, technologies.join(", "));
}

export function unknownProject(dir: string): Project {
  return describe(dir, "desconocida");
}

export function projectLabel(project: Project): string {
  return `${project.folder} · ${project.technology}`;
}

/** One line for the system prompt. The rest of that prompt is English. */
export function projectPrompt(project: Project): string {
  const technology = project.technology === "desconocida"
    ? "unrecognized (the user confirmed this directory is a project)"
    : project.technology;
  return `\nThe open project folder is ${project.folder}. Detected technology: ${technology}.\n`;
}

/**
 * `io === null` means there is no person to ask: an unrecognized directory
 * stays open as `desconocida`. An empty path answer closes the CLI.
 */
export async function resolveProject(dir: string, io: ProjectIo | null): Promise<Project | null> {
  const found = readProject(dir, io);
  if (found) return found;
  if (!io) return unknownProject(dir);
  const answer = await confirmProject(dir, io);
  if (answer === "yes") return unknownProject(dir);
  return askForPath(dir, io);
}

function readProject(dir: string, io: ProjectIo | null): Project | null {
  try {
    return detectProject(dir);
  } catch (err) {
    if (!io) throw err;
    const message = err instanceof Error ? err.message : String(err);
    io.write(`no pude leer ${dir}: ${message}`);
    return null;
  }
}

async function confirmProject(dir: string, io: ProjectIo): Promise<"yes" | "no"> {
  for (;;) {
    const answer = (await io.ask(`No reconozco un proyecto en ${dir}. ¿Estamos en un proyecto? (s/n) `)).trim().toLowerCase();
    if (yesAnswers.has(answer)) return "yes";
    if (noAnswers.has(answer)) return "no";
  }
}

async function askForPath(dir: string, io: ProjectIo): Promise<Project | null> {
  for (;;) {
    const typed = (await io.ask("Ruta del proyecto a abrir, o vacío para cerrar: ")).trim();
    if (typed === "") return null;
    const next = resolve(dir, typed);
    let info;
    try {
      info = statSync(next);
    } catch {
      io.write(`no encuentro ${next}`);
      continue;
    }
    if (!info.isDirectory()) {
      io.write(`no es un directorio: ${next}`);
      continue;
    }
    return resolveProject(next, io);
  }
}

function describe(dir: string, technology: string): Project {
  const root = realpathSync(dir);
  return { root, folder: basename(root), technology };
}

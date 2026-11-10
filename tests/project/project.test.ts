import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { detectProject, projectLabel, projectPrompt, resolveProject, type ProjectIo } from "../../src/project/project.ts";

function dir(name: string): string {
  return mkdtempSync(join(tmpdir(), name));
}

function scripted(answers: string[]): { io: ProjectIo; notes: string[] } {
  const notes: string[] = [];
  const pending = answers.slice();
  const io: ProjectIo = {
    ask() {
      const next = pending.shift();
      if (next === undefined) throw new Error("unexpected question");
      return Promise.resolve(next);
    },
    write(line) {
      notes.push(line);
    },
  };
  return { io, notes };
}

describe("detectProject", () => {
  it("names the folder and the technology", () => {
    const root = dir("harto-node-");
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    const found = detectProject(root);
    assert.ok(found);
    assert.equal(found.technology, "Node");
    assert.equal(found.folder, root.split(/[\\/]/).at(-1));
    assert.equal(projectLabel(found), `${found.folder} · Node`);
  });

  it("recognizes Maven, Gradle, and .NET", () => {
    const maven = dir("harto-mvn-");
    writeFileSync(join(maven, "pom.xml"), "<project/>", "utf8");
    assert.equal(detectProject(maven)?.technology, "Java (Maven)");

    const gradle = dir("harto-gradle-");
    writeFileSync(join(gradle, "build.gradle.kts"), "", "utf8");
    writeFileSync(join(gradle, "settings.gradle.kts"), "", "utf8");
    assert.equal(detectProject(gradle)?.technology, "Java (Gradle)");

    const dotnet = dir("harto-dotnet-");
    writeFileSync(join(dotnet, "App.sln"), "", "utf8");
    writeFileSync(join(dotnet, "App.csproj"), "", "utf8");
    assert.equal(detectProject(dotnet)?.technology, ".NET");
  });

  it("lists every technology in marker order", () => {
    const root = dir("harto-mix-");
    writeFileSync(join(root, "pom.xml"), "", "utf8");
    writeFileSync(join(root, "package.json"), "", "utf8");
    assert.equal(detectProject(root)?.technology, "Node, Java (Maven)");
  });

  it("returns null when nothing matches", () => {
    assert.equal(detectProject(dir("harto-empty-")), null);
  });
});

describe("resolveProject", () => {
  it("keeps an unrecognized directory when there is nobody to ask", async () => {
    const root = dir("harto-quiet-");
    const project = await resolveProject(root, null);
    assert.equal(project?.technology, "desconocida");
    assert.match(projectPrompt(project!), /unrecognized/);
  });

  it("accepts a confirmed project and a later path", async () => {
    const here = dir("harto-here-");
    const confirmed = scripted(["sí"]);
    const stayed = await resolveProject(here, confirmed.io);
    assert.equal(stayed?.technology, "desconocida");

    const other = dir("harto-other-");
    writeFileSync(join(other, "go.mod"), "module example\n", "utf8");
    const file = join(here, "not-a-dir.txt");
    writeFileSync(file, "", "utf8");
    const moved = scripted(["n", file, other]);
    const opened = await resolveProject(here, moved.io);
    assert.equal(opened?.technology, "Go");
    assert.equal(opened?.folder, other.split(/[\\/]/).at(-1));
    assert.match(moved.notes.join("\n"), /no es un directorio/);
  });

  it("closes when the path is empty", async () => {
    const here = dir("harto-close-");
    const { io } = scripted(["no", "  "]);
    assert.equal(await resolveProject(here, io), null);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadRegistry, saveRegistry, addProject, setActiveProject,
  resolveProjectPath, validateProjectName,
} from "../src/web/projects.js";

describe("web project registry", () => {
  let configHome: string;
  let originalConfigHome: string | undefined;

  beforeEach(() => {
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    configHome = mkdtempSync(join(tmpdir(), "web-projects-test-"));
    process.env.XDG_CONFIG_HOME = configHome;
  });

  afterEach(() => {
    if (originalConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalConfigHome;
    }
    rmSync(configHome, { recursive: true, force: true });
  });

  const registryFile = () => join(configHome, "dev-workflow", "projects.json");

  // ── validateProjectName ────────────────────────────────────────────────────

  it("validateProjectName accepts valid names", () => {
    expect(validateProjectName("dev-workflow")).toBe(true);
    expect(validateProjectName("engram")).toBe(true);
    expect(validateProjectName("my_project.2")).toBe(true);
    expect(validateProjectName("a")).toBe(true);
    expect(validateProjectName("Project1")).toBe(true);
  });

  it("validateProjectName rejects traversal, absolute, empty, over-length", () => {
    expect(validateProjectName("../escape")).toBe(false);
    expect(validateProjectName("foo/bar")).toBe(false);
    expect(validateProjectName("/absolute")).toBe(false);
    expect(validateProjectName("")).toBe(false);
    expect(validateProjectName("x".repeat(81))).toBe(false);
    expect(validateProjectName("name with spaces")).toBe(false);
    expect(validateProjectName(".hidden")).toBe(false);
    expect(validateProjectName("__proto__")).toBe(false);
  });

  // ── loadRegistry ───────────────────────────────────────────────────────────

  it("loadRegistry returns empty registry when file missing", () => {
    const registry = loadRegistry();
    expect(registry.projects).toEqual({});
    expect(registry.activeProject).toBeNull();
  });

  it("loadRegistry returns empty registry on malformed JSON, no throw", () => {
    mkdirSync(join(configHome, "dev-workflow"), { recursive: true });
    writeFileSync(registryFile(), "not json {{{", "utf-8");
    const registry = loadRegistry();
    expect(registry.projects).toEqual({});
    expect(registry.activeProject).toBeNull();
  });

  it("loadRegistry returns empty registry on non-object JSON, no throw", () => {
    mkdirSync(join(configHome, "dev-workflow"), { recursive: true });
    writeFileSync(registryFile(), "[1,2,3]", "utf-8");
    expect(loadRegistry().projects).toEqual({});
    writeFileSync(registryFile(), "42", "utf-8");
    expect(loadRegistry().projects).toEqual({});
    writeFileSync(registryFile(), "null", "utf-8");
    expect(loadRegistry().projects).toEqual({});
  });

  it("loadRegistry drops malformed entries and clears dangling activeProject", () => {
    mkdirSync(join(configHome, "dev-workflow"), { recursive: true });
    writeFileSync(registryFile(), JSON.stringify({
      projects: {
        valid: { name: "valid", path: "/tmp/valid", lastSeen: "2026-05-18T00:00:00Z" },
        "bad name": { name: "bad name", path: "/tmp/bad", lastSeen: "x" },
        noPath: { name: "noPath", lastSeen: "x" },
        nullEntry: null,
      },
      activeProject: "ghost",
    }), "utf-8");
    const registry = loadRegistry();
    expect(Object.keys(registry.projects)).toEqual(["valid"]);
    expect(registry.activeProject).toBeNull();
  });

  it("loadRegistry does not pollute Object.prototype via __proto__ key", () => {
    mkdirSync(join(configHome, "dev-workflow"), { recursive: true });
    writeFileSync(registryFile(), '{"projects":{"__proto__":{"path":"/evil","name":"__proto__","lastSeen":"x"},"constructor":{"path":"/evil2"}},"activeProject":null}', "utf-8");
    const registry = loadRegistry();
    expect(({} as Record<string, unknown>).path).toBeUndefined();
    expect(Object.keys(registry.projects)).toEqual([]);
  });

  // ── addProject / saveRegistry round-trip ───────────────────────────────────

  it("addProject registers cwd and round-trips through save/load", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "demo-project-"));
    const project = addProject(projectDir);
    expect(project.path).toBe(projectDir);
    expect(validateProjectName(project.name)).toBe(true);

    const reloaded = loadRegistry();
    expect(reloaded.projects[project.name]).toBeDefined();
    expect(reloaded.projects[project.name]!.path).toBe(projectDir);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("addProject is idempotent on the same cwd", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "idem-project-"));
    const first = addProject(projectDir);
    const second = addProject(projectDir);
    expect(second.name).toBe(first.name);
    expect(Object.keys(loadRegistry().projects)).toHaveLength(1);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("addProject slugifies an uppercase/space basename into a valid name", () => {
    const base = mkdtempSync(join(tmpdir(), "slug-base-"));
    const projectDir = join(base, "My Cool Project");
    mkdirSync(projectDir, { recursive: true });
    const project = addProject(projectDir);
    expect(validateProjectName(project.name)).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });

  it("addProject throws when the basename cannot yield a valid name", () => {
    const base = mkdtempSync(join(tmpdir(), "unfix-base-"));
    const projectDir = join(base, "!!!");
    mkdirSync(projectDir, { recursive: true });
    expect(() => addProject(projectDir)).toThrow(/project name/i);
    rmSync(base, { recursive: true, force: true });
  });

  it("addProject throws when cwd is not an absolute path", () => {
    expect(() => addProject("relative/path")).toThrow(/absolute/i);
  });

  // ── setActiveProject / resolveProjectPath ──────────────────────────────────

  it("setActiveProject + resolveProjectPath resolve the active project path", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "active-project-"));
    const project = addProject(projectDir);
    setActiveProject(project.name);
    expect(loadRegistry().activeProject).toBe(project.name);
    expect(resolveProjectPath(project.name)).toBe(projectDir);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("setActiveProject throws for an unknown project name", () => {
    expect(() => setActiveProject("nonexistent")).toThrow(/unknown project/i);
  });

  it("resolveProjectPath throws for an unknown project name", () => {
    expect(() => resolveProjectPath("nonexistent")).toThrow(/unknown project/i);
  });

  // ── saveRegistry atomicity ─────────────────────────────────────────────────

  it("saveRegistry leaves no .tmp file behind", () => {
    saveRegistry({
      projects: { demo: { name: "demo", path: "/tmp/demo", lastSeen: "2026-05-18T00:00:00Z" } },
      activeProject: "demo",
    });
    const dir = join(configHome, "dev-workflow");
    const leftovers = readdirSync(dir).filter((entry) => entry.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    expect(existsSync(registryFile())).toBe(true);
  });

  it("saveRegistry output parses back identically", () => {
    const registry = {
      projects: {
        one: { name: "one", path: "/tmp/one", lastSeen: "2026-05-18T00:00:00Z" },
        two: { name: "two", path: "/tmp/two", lastSeen: "2026-05-18T01:00:00Z" },
      },
      activeProject: "two" as string | null,
    };
    saveRegistry(registry);
    const parsed = JSON.parse(readFileSync(registryFile(), "utf-8"));
    expect(parsed.activeProject).toBe("two");
    expect(Object.keys(parsed.projects).sort()).toEqual(["one", "two"]);
  });
});

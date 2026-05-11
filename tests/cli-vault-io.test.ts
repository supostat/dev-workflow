import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { exportVault, importVault } from "../src/cli/vault-io.js";

describe("vault-io CLI — E2E (export + import)", () => {
  let projectRoot: string;
  let vaultPath: string;
  let originalCwd: string;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-vault-io-test-"));
    vaultPath = join(projectRoot, ".dev-vault");
    process.chdir(projectRoot);

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "vault-io-test" }), "utf-8");

    logOutput = [];
    errOutput = [];
    origLog = console.log;
    origErr = console.error;
    console.log = ((msg: string) => { logOutput.push(String(msg)); return true; }) as typeof console.log;
    console.error = ((msg: string) => { errOutput.push(String(msg)); return true; }) as typeof console.error;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function logJoined(): string { return logOutput.join("\n"); }
  function errJoined(): string { return errOutput.join("\n"); }

  // ── export ────────────────────────────────────────────────────────────────

  it("export: not-in-git-repo → error + exitCode=1", () => {
    const nonGit = mkdtempSync(join(tmpdir(), "cli-vault-io-non-git-"));
    process.chdir(nonGit);
    try {
      exportVault([]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("export: no vault → error + exitCode=1", () => {
    exportVault([]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("No vault found");
  });

  it("export: default output path is vault-export.json", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n\nNode.js\n", "utf-8");
    exportVault([]);
    expect(existsSync(join(projectRoot, "vault-export.json"))).toBe(true);
    expect(logJoined()).toMatch(/Exported \d+ files → vault-export\.json/);
  });

  it("export: custom output path argument", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n", "utf-8");
    const customPath = join(projectRoot, "my-backup.json");
    exportVault([customPath]);
    expect(existsSync(customPath)).toBe(true);
    expect(logJoined()).toContain("my-backup.json");
  });

  it("export: JSON shape — version 1, projectName, exportedAt, files map", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "stack content", "utf-8");
    writeFileSync(join(vaultPath, "knowledge.md"), "knowledge content", "utf-8");
    exportVault([]);

    const exported = JSON.parse(readFileSync(join(projectRoot, "vault-export.json"), "utf-8")) as Record<string, unknown>;
    expect(exported["version"]).toBe(1);
    expect(exported["projectName"]).toMatch(/cli-vault-io-test-/);
    expect(exported["exportedAt"]).toBeDefined();
    const files = exported["files"] as Record<string, string>;
    expect(files["stack.md"]).toBe("stack content");
    expect(files["knowledge.md"]).toBe("knowledge content");
  });

  it("export: includes .md and .json files, ignores other extensions", () => {
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "md content", "utf-8");
    writeFileSync(join(vaultPath, "data.json"), '{"k":"v"}', "utf-8");
    writeFileSync(join(vaultPath, "image.png"), "binary data", "utf-8");
    writeFileSync(join(vaultPath, "notes.txt"), "text content", "utf-8");
    exportVault([]);

    const exported = JSON.parse(readFileSync(join(projectRoot, "vault-export.json"), "utf-8")) as Record<string, unknown>;
    const files = exported["files"] as Record<string, string>;
    expect(files["stack.md"]).toBeDefined();
    expect(files["data.json"]).toBeDefined();
    expect(files["image.png"]).toBeUndefined();
    expect(files["notes.txt"]).toBeUndefined();
  });

  it("export: recurses into subdirectories", () => {
    mkdirSync(join(vaultPath, "architecture"), { recursive: true });
    mkdirSync(join(vaultPath, "debt"), { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "root", "utf-8");
    writeFileSync(join(vaultPath, "architecture", "adr-1.md"), "adr", "utf-8");
    writeFileSync(join(vaultPath, "debt", "old.md"), "debt body", "utf-8");
    exportVault([]);

    const exported = JSON.parse(readFileSync(join(projectRoot, "vault-export.json"), "utf-8")) as Record<string, unknown>;
    const files = exported["files"] as Record<string, string>;
    expect(files["stack.md"]).toBe("root");
    expect(files["architecture/adr-1.md"]).toBe("adr");
    expect(files["debt/old.md"]).toBe("debt body");
  });

  // ── import ────────────────────────────────────────────────────────────────

  it("import: not-in-git-repo → error + exitCode=1", () => {
    const nonGit = mkdtempSync(join(tmpdir(), "cli-vault-io-non-git-imp-"));
    process.chdir(nonGit);
    try {
      importVault(["any.json"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("import: missing path → usage + exitCode=1", () => {
    importVault([]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow import");
  });

  it("import: nonexistent file → usage + exitCode=1", () => {
    importVault(["nonexistent-export.json"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow import");
  });

  it("import: unsupported version → error + exitCode=1", () => {
    const exportPath = join(projectRoot, "bad-version.json");
    writeFileSync(exportPath, JSON.stringify({
      version: 999,
      projectName: "x",
      exportedAt: "2026-01-01T00:00:00Z",
      files: {},
    }), "utf-8");
    importVault([exportPath]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Unsupported export version: 999");
  });

  it("import: writes files to vault + reports count + project name", () => {
    const exportPath = join(projectRoot, "fixture.json");
    writeFileSync(exportPath, JSON.stringify({
      version: 1,
      projectName: "source-project",
      exportedAt: "2026-05-11T10:00:00Z",
      files: {
        "stack.md": "imported stack\n",
        "knowledge.md": "imported knowledge\n",
        "architecture/adr-001.md": "imported adr\n",
      },
    }), "utf-8");

    importVault([exportPath]);
    expect(process.exitCode).not.toBe(1);
    expect(logJoined()).toContain("Imported 3 files from source-project");
    expect(logJoined()).toContain("2026-05-11T10:00:00Z");
    expect(readFileSync(join(vaultPath, "stack.md"), "utf-8")).toBe("imported stack\n");
    expect(readFileSync(join(vaultPath, "knowledge.md"), "utf-8")).toBe("imported knowledge\n");
    expect(readFileSync(join(vaultPath, "architecture", "adr-001.md"), "utf-8")).toBe("imported adr\n");
  });

  it("round-trip: export → import preserves content", () => {
    mkdirSync(join(vaultPath, "debt"), { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "round-trip stack", "utf-8");
    writeFileSync(join(vaultPath, "debt", "item.md"), "round-trip debt item", "utf-8");
    exportVault(["round-trip.json"]);

    // Trash vault then import
    rmSync(vaultPath, { recursive: true, force: true });
    importVault([join(projectRoot, "round-trip.json")]);

    expect(readFileSync(join(vaultPath, "stack.md"), "utf-8")).toBe("round-trip stack");
    expect(readFileSync(join(vaultPath, "debt", "item.md"), "utf-8")).toBe("round-trip debt item");
  });
});

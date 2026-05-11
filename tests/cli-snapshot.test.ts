import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { snapshot } from "../src/cli/snapshot.js";

describe("snapshot CLI — E2E", () => {
  let projectRoot: string;
  let vaultPath: string;
  let originalCwd: string;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-snapshot-test-"));
    vaultPath = join(projectRoot, ".dev-vault");
    process.chdir(projectRoot);

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "snap-test" }), "utf-8");

    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "stack.md"), "# Stack\n\nNode.js\n", "utf-8");
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\n", "utf-8");

    logOutput = [];
    errOutput = [];
    origLog = console.log;
    origErr = console.error;
    console.log = ((msg: string = "") => { logOutput.push(String(msg)); return true; }) as typeof console.log;
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

  // ── basic plumbing ────────────────────────────────────────────────────────

  it("no subcommand → usage + exitCode=1", () => {
    snapshot([]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow snapshot");
  });

  it("unknown subcommand → usage + exitCode=1", () => {
    snapshot(["bogus"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Unknown subcommand: bogus");
  });

  it("not-in-git-repo: error + exitCode=1", () => {
    const nonGit = mkdtempSync(join(tmpdir(), "cli-snapshot-non-git-"));
    process.chdir(nonGit);
    try {
      snapshot(["list"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  // ── create ────────────────────────────────────────────────────────────────

  it("create with explicit name: writes snapshot + manifest, logs summary", () => {
    snapshot(["create", "v1-baseline"]);
    expect(process.exitCode).not.toBe(1);
    expect(logJoined()).toContain('Created snapshot "v1-baseline"');
    expect(existsSync(join(vaultPath, "snapshots", "v1-baseline", "manifest.json"))).toBe(true);
    expect(existsSync(join(vaultPath, "snapshots", "v1-baseline", "stack.md"))).toBe(true);
  });

  it("create without name: uses default timestamp-based name", () => {
    snapshot(["create"]);
    expect(process.exitCode).not.toBe(1);
    const match = logJoined().match(/Created snapshot "(snap-\d{4}-\d{2}-\d{2}T[^"]+)"/);
    expect(match).not.toBeNull();
    expect(existsSync(join(vaultPath, "snapshots", match![1]!))).toBe(true);
  });

  it("create twice with same name: error + exitCode=1", () => {
    snapshot(["create", "dup"]);
    logOutput.length = 0;
    errOutput.length = 0;
    snapshot(["create", "dup"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("already exists");
  });

  it("create with invalid name (path traversal): error + exitCode=1", () => {
    snapshot(["create", "../escape"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Invalid snapshot name");
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it("list empty: 'No snapshots found.'", () => {
    snapshot(["list"]);
    expect(logJoined()).toContain("No snapshots found");
  });

  it("list with snapshots: shows table with name/created/branch/files/size", () => {
    snapshot(["create", "alpha"]);
    logOutput.length = 0;
    snapshot(["list"]);
    const out = logJoined();
    expect(out).toContain("Snapshots");
    expect(out).toContain("Name");
    expect(out).toContain("Branch");
    expect(out).toContain("Files");
    expect(out).toContain("Size");
    expect(out).toContain("alpha");
  });

  // ── show ──────────────────────────────────────────────────────────────────

  it("show without name: usage + exitCode=1", () => {
    snapshot(["show"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow snapshot show");
  });

  it("show valid snapshot: prints JSON manifest with stable full shape", () => {
    snapshot(["create", "showme"]);
    logOutput.length = 0;
    snapshot(["show", "showme"]);
    const out = logJoined();
    const parsed = JSON.parse(out) as Record<string, unknown>;
    // Pin EVERY field of SnapshotMeta — protects stable JSON contract
    expect(parsed).toHaveProperty("name");
    expect(parsed).toHaveProperty("createdAt");
    expect(parsed).toHaveProperty("projectName");
    expect(parsed).toHaveProperty("branch");
    expect(parsed).toHaveProperty("fileCount");
    expect(parsed).toHaveProperty("totalBytes");
    expect(parsed).toHaveProperty("excludedPatterns");
    expect(parsed["name"]).toBe("showme");
    expect(typeof parsed["createdAt"]).toBe("string");
    expect(typeof parsed["fileCount"]).toBe("number");
    expect(typeof parsed["totalBytes"]).toBe("number");
    expect(Array.isArray(parsed["excludedPatterns"])).toBe(true);
  });

  it("show nonexistent snapshot: error + exitCode=1", () => {
    snapshot(["show", "phantom"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("not found");
  });

  // ── delete ────────────────────────────────────────────────────────────────

  it("delete without name: usage + exitCode=1", () => {
    snapshot(["delete"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow snapshot delete");
  });

  it("delete without --force: warning + exitCode=1 (no deletion)", () => {
    snapshot(["create", "doomed"]);
    logOutput.length = 0;
    errOutput.length = 0;
    snapshot(["delete", "doomed"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Pass --force to confirm");
    expect(existsSync(join(vaultPath, "snapshots", "doomed"))).toBe(true); // still there
  });

  it("delete --force: removes snapshot + success message", () => {
    snapshot(["create", "doomed"]);
    logOutput.length = 0;
    snapshot(["delete", "doomed", "--force"]);
    expect(process.exitCode).not.toBe(1);
    expect(logJoined()).toContain('Deleted snapshot "doomed"');
    expect(existsSync(join(vaultPath, "snapshots", "doomed"))).toBe(false);
  });

  it("delete nonexistent: error + exitCode=1", () => {
    snapshot(["delete", "phantom", "--force"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("not found");
  });

  // ── rollback ──────────────────────────────────────────────────────────────

  it("rollback without name: usage + exitCode=1", () => {
    snapshot(["rollback"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow snapshot rollback");
  });

  it("rollback nonexistent: error + exitCode=1", () => {
    snapshot(["rollback", "phantom"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("not found");
  });

  it("rollback restores vault content + reports pre-rollback snapshot", () => {
    // Initial state
    snapshot(["create", "v1"]);
    logOutput.length = 0;
    // Modify vault
    writeFileSync(join(vaultPath, "stack.md"), "# MODIFIED\n", "utf-8");
    writeFileSync(join(vaultPath, "new.md"), "added later\n", "utf-8");

    snapshot(["rollback", "v1"]);
    expect(process.exitCode).not.toBe(1);
    expect(readFileSync(join(vaultPath, "stack.md"), "utf-8")).toBe("# Stack\n\nNode.js\n");
    expect(existsSync(join(vaultPath, "new.md"))).toBe(false);
    expect(logJoined()).toContain('Rolled back to "v1"');
    expect(logJoined()).toContain("Pre-rollback snapshot");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { task } from "../src/cli/task.js";

describe("task CLI — E2E", () => {
  let projectRoot: string;
  let originalCwd: string;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-task-test-"));
    process.chdir(projectRoot);

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "test-task-project" }), "utf-8");

    // Minimal vault scaffold — task manager requires .dev-vault/tasks/ to exist
    mkdirSync(join(projectRoot, ".dev-vault", "tasks"), { recursive: true });

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

  it("not-in-git-repo: error + exitCode=1", () => {
    const nonGit = mkdtempSync(join(tmpdir(), "cli-task-non-git-"));
    process.chdir(nonGit);
    try {
      task(["list"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("unknown subcommand prints usage + exitCode=1", () => {
    task(["bogus"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow task");
  });

  it("no subcommand → usage + exitCode=1", () => {
    task([]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow task");
  });

  // ── create ────────────────────────────────────────────────────────────────

  it("create: title required", () => {
    task(["create"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain('Usage: dev-workflow task create "title"');
  });

  it("create: writes a task file with the title", () => {
    task(["create", "Fix login bug"]);
    expect(process.exitCode).not.toBe(1);
    expect(logJoined()).toMatch(/Created task-\d+: Fix login bug/);
    // Verify the file exists
    const tasksDir = join(projectRoot, ".dev-vault", "tasks");
    const files = require("node:fs").readdirSync(tasksDir);
    const taskFiles = files.filter((f: string) => f.startsWith("task-") && f.endsWith(".md"));
    expect(taskFiles).toHaveLength(1);
    const content = readFileSync(join(tasksDir, taskFiles[0]), "utf-8");
    expect(content).toContain("Fix login bug");
  });

  it("create: accepts optional description", () => {
    task(["create", "Add feature X", "Detailed description here"]);
    expect(process.exitCode).not.toBe(1);
    const tasksDir = join(projectRoot, ".dev-vault", "tasks");
    const files = require("node:fs").readdirSync(tasksDir) as string[];
    const file = files.find((f) => f.endsWith(".md"))!;
    const content = readFileSync(join(tasksDir, file), "utf-8");
    expect(content).toContain("Detailed description here");
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it("list: empty vault prints 'No tasks found'", () => {
    task(["list"]);
    expect(logJoined()).toContain("No tasks found");
  });

  it("list: shows created tasks in a table with ID/Title/Status/Priority columns", () => {
    task(["create", "Task A"]);
    logOutput.length = 0;
    task(["list"]);
    const out = logJoined();
    expect(out).toContain("Tasks");
    expect(out).toContain("ID");
    expect(out).toContain("Title");
    expect(out).toContain("Status");
    expect(out).toContain("Task A");
  });

  it("list --status filters by status (no match → 'No tasks found')", () => {
    task(["create", "Pending Task"]);
    logOutput.length = 0;
    task(["list", "--status", "done"]);
    expect(logJoined()).toContain("No tasks found");
  });

  // ── show ──────────────────────────────────────────────────────────────────

  it("show: id required", () => {
    task(["show"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow task show <id>");
  });

  it("show: nonexistent id → error + exitCode=1", () => {
    task(["show", "task-999999"]);
    expect(process.exitCode).toBe(1);
  });

  it("show: existing task prints all fields", () => {
    task(["create", "Show Test", "Some description body"]);
    const createOut = logJoined();
    const idMatch = createOut.match(/task-\d+/);
    expect(idMatch).not.toBeNull();
    logOutput.length = 0;

    task(["show", idMatch![0]]);
    const out = logJoined();
    expect(out).toContain("ID:");
    expect(out).toContain("Title:       Show Test");
    expect(out).toContain("Status:");
    expect(out).toContain("Some description body");
  });

  // ── done / block ──────────────────────────────────────────────────────────

  it("done: id required", () => {
    task(["done"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow task done <id>");
  });

  it("done: marks task as done", () => {
    task(["create", "To Complete"]);
    const id = logJoined().match(/task-\d+/)![0];
    logOutput.length = 0;

    task(["done", id]);
    expect(logJoined()).toContain(`Task ${id} marked as done`);

    // Verify status via show
    logOutput.length = 0;
    task(["show", id]);
    expect(logJoined()).toMatch(/Status:\s+done/);
  });

  it("done: nonexistent id → error + exitCode=1", () => {
    task(["done", "task-999999"]);
    expect(process.exitCode).toBe(1);
  });

  it("block: id required", () => {
    task(["block"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow task block <id>");
  });

  it("block: marks task as blocked", () => {
    task(["create", "Will Block"]);
    const id = logJoined().match(/task-\d+/)![0];
    logOutput.length = 0;

    task(["block", id]);
    expect(logJoined()).toContain(`Task ${id} marked as blocked`);

    logOutput.length = 0;
    task(["show", id]);
    expect(logJoined()).toMatch(/Status:\s+blocked/);
  });

  // ── start ─────────────────────────────────────────────────────────────────

  it("start: id required", () => {
    task(["start"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow task start <id>");
  });

  it("start: nonexistent id → error + exitCode=1", () => {
    task(["start", "task-999999"]);
    expect(process.exitCode).toBe(1);
  });

  it("start: creates a branch named task/<slug> and reports", () => {
    task(["create", "My Cool Feature!"]);
    const id = logJoined().match(/task-\d+/)![0];
    logOutput.length = 0;

    task(["start", id]);
    expect(logJoined()).toMatch(/^Task task-\d+ started on branch task\/my-cool-feature/m);
  });

  // ── create-from-phase ─────────────────────────────────────────────────────

  it("create-from-phase: file path required", () => {
    task(["create-from-phase"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Usage: dev-workflow task create-from-phase");
  });

  it("create-from-phase: missing phase file → error", () => {
    task(["create-from-phase", "nonexistent-phase.md"]);
    expect(process.exitCode).toBe(1);
  });

  it("create-from-phase: parses ## Tasks list and creates each", () => {
    const phaseFile = join(projectRoot, "phase-x.md");
    writeFileSync(phaseFile,
      `---\nphase: x\n---\n# Phase X\n\n## Tasks\n\n- [ ] First subtask\n- [ ] Second subtask\n- [ ] Third subtask\n`,
      "utf-8");

    task(["create-from-phase", "phase-x.md"]);
    expect(process.exitCode).not.toBe(1);
    const out = logJoined();
    expect(out).toContain("Created 3 tasks");
    expect(out).toContain("First subtask");
    expect(out).toContain("Second subtask");
    expect(out).toContain("Third subtask");
  });

  it("create-from-phase: skips tasks that already exist", () => {
    const phaseFile = join(projectRoot, "phase-y.md");
    writeFileSync(phaseFile,
      `---\nphase: y\n---\n## Tasks\n\n- [ ] Dup task\n`, "utf-8");

    task(["create-from-phase", "phase-y.md"]);
    logOutput.length = 0;
    task(["create-from-phase", "phase-y.md"]);
    expect(logJoined()).toContain("Skipped 1");
  });

  it("create-from-phase: 'No tasks found' when ## Tasks section absent", () => {
    const phaseFile = join(projectRoot, "phase-empty.md");
    writeFileSync(phaseFile, "# Phase Empty\n\nNo tasks here.\n", "utf-8");

    task(["create-from-phase", "phase-empty.md"]);
    expect(logJoined()).toContain("No tasks found in phase file");
  });

  it("create-from-phase: accepts absolute path", () => {
    const phaseFile = join(projectRoot, "phase-abs.md");
    writeFileSync(phaseFile, "## Tasks\n\n- [ ] Absolute path task\n", "utf-8");

    task(["create-from-phase", phaseFile]); // absolute
    expect(process.exitCode).not.toBe(1);
    expect(logJoined()).toContain("Absolute path task");
  });

  it("create-from-phase: rejects a relative path containing '..'", () => {
    task(["create-from-phase", "../escape.md"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("phaseFile must not contain '..'");
    expect(logJoined()).not.toContain("Created");
  });

  it("create-from-phase: rejects a '..'-disguised nested path", () => {
    task(["create-from-phase", "foo/../../escape.md"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("phaseFile must not contain '..'");
    expect(logJoined()).not.toContain("Created");
  });
});

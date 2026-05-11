import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { status } from "../src/cli/status.js";

describe("status CLI — E2E", () => {
  let projectRoot: string;
  let originalCwd: string;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-status-test-"));
    process.chdir(projectRoot);

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "status-test" }), "utf-8");

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
    const nonGit = mkdtempSync(join(tmpdir(), "cli-status-non-git-"));
    process.chdir(nonGit);
    try {
      status();
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("no vault: warning + early box-close", () => {
    status();
    const out = logJoined();
    expect(out).toContain("status-test");
    expect(out).toContain("No vault");
    expect(out).toContain("dev-workflow init");
  });

  it("empty vault files: all show 'empty' label", () => {
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    for (const fname of ["stack.md", "conventions.md", "knowledge.md", "gameplan.md"]) {
      writeFileSync(join(projectRoot, ".dev-vault", fname), "---\nupdated: 2026-01-01\n---\n", "utf-8");
    }
    status();
    const out = logJoined();
    expect(out).toContain("stack");
    expect(out).toContain("conventions");
    expect(out).toContain("knowledge");
    expect(out).toContain("gameplan");
    expect(out).toMatch(/empty/);
  });

  it("filled vault files: 'N lines' label", () => {
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    const filled = "---\nupdated: 2026-01-01\n---\n" + Array(20).fill("content line").join("\n");
    for (const fname of ["stack.md", "conventions.md", "knowledge.md", "gameplan.md"]) {
      writeFileSync(join(projectRoot, ".dev-vault", fname), filled, "utf-8");
    }
    status();
    expect(logJoined()).toMatch(/\d+ lines/);
  });

  it("missing vault files: 'missing' label", () => {
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"),
      "---\nupdated: 2026-01-01\n---\nContent\n", "utf-8");
    // Other 3 files absent
    status();
    const out = logJoined();
    expect(out).toContain("missing");
  });

  it("no tasks: shows 'Tasks        none'", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "tasks"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), "---\nupdated: 2026-01-01\n---\nx\n", "utf-8");
    status();
    expect(logJoined()).toMatch(/Tasks\s+none/);
  });

  it("with tasks: shows total + status summary", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "tasks"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), "---\nupdated: 2026-01-01\n---\nx\n", "utf-8");
    const taskBody = (id: string, st: string) =>
      `---\nid: ${id}\ntitle: Sample ${id}\nstatus: ${st}\npriority: medium\ncreated: 2026-01-01\nupdated: 2026-01-01\nbranch: null\nworkflowRun: null\n---\n`;
    writeFileSync(join(projectRoot, ".dev-vault", "tasks", "task-001.md"), taskBody("task-001", "pending"), "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "tasks", "task-002.md"), taskBody("task-002", "done"), "utf-8");
    status();
    const out = logJoined();
    expect(out).toMatch(/Tasks\s+2 total/);
    expect(out).toMatch(/pending: 1/);
    expect(out).toMatch(/done: 1/);
  });

  it("recent daily logs: shown if present", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "daily"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), "---\nupdated: 2026-01-01\n---\nx\n", "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "daily", "2026-05-11.md"),
      "---\ndate: 2026-05-11\n---\n# Log\n", "utf-8");
    status();
    const out = logJoined();
    expect(out).toContain("Sessions");
    expect(out).toContain("2026-05-11");
  });

  it("no daily logs: section omitted", () => {
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), "---\nupdated: 2026-01-01\n---\nx\n", "utf-8");
    status();
    expect(logJoined()).not.toContain("Sessions");
  });

  it("active workflow run: shows workflow name + step + status", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "workflows"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), "---\nupdated: 2026-01-01\n---\nx\n", "utf-8");
    const run = {
      id: "run-2026-05-11-001",
      workflowName: "dev",
      taskId: null,
      taskDescription: "Sample task",
      currentStep: "code",
      startedAt: "2026-05-11T10:00:00Z",
      completedAt: null,
      status: "running",
      steps: {
        read: { status: "completed", output: "x", startedAt: null, completedAt: null, durationMs: null, attempt: 1, engramMemoryId: null, error: null },
        plan: { status: "completed", output: "y", startedAt: null, completedAt: null, durationMs: null, attempt: 1, engramMemoryId: null, error: null },
        code: { status: "running", output: null, startedAt: null, completedAt: null, durationMs: null, attempt: 1, engramMemoryId: null, error: null },
      },
    };
    writeFileSync(join(projectRoot, ".dev-vault", "workflows", "run-2026-05-11-001.json"),
      JSON.stringify(run), "utf-8");
    status();
    const out = logJoined();
    expect(out).toContain("Workflow");
    expect(out).toContain("dev (run-2026-05-11-001)");
    expect(out).toMatch(/Step: code \(2\/3\)/);
    expect(out).toMatch(/Status:.*running/);
  });

  it("project name visible in header", () => {
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), "---\nupdated: 2026-01-01\n---\nx\n", "utf-8");
    status();
    expect(logJoined()).toContain("status-test");
  });
});

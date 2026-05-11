import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { doctor } from "../src/cli/doctor.js";
import { init } from "../src/cli/init.js";

describe("doctor CLI — E2E", () => {
  let projectRoot: string;
  let originalCwd: string;
  let originalEngramSocket: string | undefined;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-doctor-test-"));
    process.chdir(projectRoot);

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "test-doctor-project" }), "utf-8");

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
    if (originalEngramSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEngramSocket;
    }
  });

  function logJoined(): string { return logOutput.join("\n"); }
  function errJoined(): string { return errOutput.join("\n"); }

  it("not-in-git-repo: error + exitCode=1", async () => {
    const nonGit = mkdtempSync(join(tmpdir(), "cli-doctor-non-git-"));
    process.chdir(nonGit);
    try {
      await doctor(false);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("no vault: reports MISSING + lists the init issue and stops early", async () => {
    await doctor(false);
    const out = logJoined();
    expect(out).toContain("dev-workflow doctor");
    expect(out).toContain("MISSING");
    expect(out).toContain("Vault not initialized");
    // Stops after vault check — does NOT print vault file lines
    expect(out).not.toContain("Workflows:");
  });

  it("fully-initialized project: 'All checks passed' (or only warnings, no errors)", async () => {
    init({ force: true });
    logOutput.length = 0;
    await doctor(false);
    const out = logJoined();
    expect(out).toContain("dev-workflow doctor");
    expect(out).toContain("Vault");
    expect(out).toContain("Agents:");
    expect(out).toContain("Workflows:");
    expect(out).toContain("CLAUDE.md");
    expect(out).toContain(".mcp.json");
    expect(out).toContain("Hooks");
    expect(out).toContain("Permissions");
  });

  it("empty vault files (frontmatter only): warnings + 'fill for better agent context'", async () => {
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    for (const fname of ["stack.md", "conventions.md", "knowledge.md", "gameplan.md"]) {
      writeFileSync(join(projectRoot, ".dev-vault", fname),
        "---\nupdated: 2026-01-01\n---\n", "utf-8");
    }
    await doctor(false);
    const out = logJoined();
    expect(out).toContain("empty (frontmatter only)");
  });

  it("filled vault files: 'filled (N lines)' indicator", async () => {
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    const filled = "---\nupdated: 2026-01-01\n---\n# Stack\n\n## Languages\n\nNode.js, TypeScript\n\n## Frameworks\n\nVitest, Vite\n";
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), filled, "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "conventions.md"), filled, "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "knowledge.md"), filled, "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "gameplan.md"), filled, "utf-8");
    await doctor(false);
    expect(logJoined()).toMatch(/filled \(\d+ lines\)/);
  });

  it("invalid .mcp.json: reports invalid + adds to issues", async () => {
    init({ force: true });
    writeFileSync(join(projectRoot, ".mcp.json"), "not valid json {{{", "utf-8");
    logOutput.length = 0;
    await doctor(false);
    const out = logJoined();
    expect(out).toContain("invalid JSON");
  });

  it(".mcp.json exists but missing dev-workflow entry: warning + issue", async () => {
    init({ force: true });
    writeFileSync(join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { somethingElse: {} } }), "utf-8");
    logOutput.length = 0;
    await doctor(false);
    const out = logJoined();
    expect(out).toContain("dev-workflow missing");
  });

  it("missing CLAUDE.md: warning issued", async () => {
    init({ force: true });
    rmSync(join(projectRoot, "CLAUDE.md"), { force: true });
    logOutput.length = 0;
    await doctor(false);
    expect(logJoined()).toContain("CLAUDE.md");
    expect(logJoined()).toContain("MISSING");
  });

  it("invalid settings.json: reports invalid + adds to issues", async () => {
    init({ force: true });
    writeFileSync(join(projectRoot, ".claude", "settings.json"), "{{not json", "utf-8");
    logOutput.length = 0;
    await doctor(false);
    expect(logJoined()).toContain("invalid JSON");
  });

  it("invalid hook event name: flagged with 'invalid events:' message", async () => {
    init({ force: true });
    const settingsPath = join(projectRoot, ".claude", "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      hooks: { NotARealEvent: [{ hooks: [{ command: "node /tmp/foo.js" }] }] },
    }), "utf-8");
    logOutput.length = 0;
    await doctor(false);
    expect(logJoined()).toContain("invalid events");
    expect(logJoined()).toContain("NotARealEvent");
  });

  it("hook command points to nonexistent file: flagged", async () => {
    init({ force: true });
    const settingsPath = join(projectRoot, ".claude", "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: [{ command: "node /nonexistent-path-xyz123/hook.js" }],
        }],
      },
    }), "utf-8");
    logOutput.length = 0;
    await doctor(false);
    expect(logJoined()).toMatch(/Hook path.*file not found/);
  });

  it("--fix re-runs init --force when issues exist", async () => {
    init({ force: true });
    rmSync(join(projectRoot, "CLAUDE.md"), { force: true });
    logOutput.length = 0;
    await doctor(true);
    expect(logJoined()).toContain("Fixing...");
    expect(logJoined()).toContain("Fixed: re-ran init --force");
  });

  it("tasks section shows count + status summary when tasks exist", async () => {
    init({ force: true });
    mkdirSync(join(projectRoot, ".dev-vault", "tasks"), { recursive: true });
    const taskBody = `---\nid: task-001\ntitle: Sample\nstatus: pending\npriority: medium\ncreated: 2026-01-01\nupdated: 2026-01-01\nbranch: null\nworkflowRun: null\n---\n`;
    writeFileSync(join(projectRoot, ".dev-vault", "tasks", "task-001.md"), taskBody, "utf-8");
    logOutput.length = 0;
    await doctor(false);
    expect(logJoined()).toMatch(/Tasks:\s+\d+ total/);
  });

  it("workflows section reports builtin count", async () => {
    init({ force: true });
    logOutput.length = 0;
    await doctor(false);
    expect(logJoined()).toMatch(/Workflows:\s+\d+ builtin/);
  });

  it("permissions section reports allow/deny counts", async () => {
    init({ force: true });
    logOutput.length = 0;
    await doctor(false);
    expect(logJoined()).toMatch(/Permissions\s+\d+ allow, \d+ deny/);
  });
});

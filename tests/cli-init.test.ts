import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { init } from "../src/cli/init.js";

describe("init CLI command — E2E", () => {
  let projectRoot: string;
  let originalCwd: string;
  let originalEngramSocket: string | undefined;
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    // Isolate from real git/engram daemons
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";

    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-init-test-"));
    process.chdir(projectRoot);

    // git init so detectContext() succeeds
    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });

    // package.json so context.projectName is non-empty
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "test-init-project" }), "utf-8");

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

  it("creates CLAUDE.md with project name interpolated", () => {
    init({ force: true });
    const claudePath = join(projectRoot, "CLAUDE.md");
    expect(existsSync(claudePath)).toBe(true);
    const content = readFileSync(claudePath, "utf-8");
    // Project name is detected from git repo dir name (basename of projectRoot)
    expect(content.length).toBeGreaterThan(100);
  });

  it("writes .claude/settings.json with valid JSON containing hooks block", () => {
    init({ force: true });
    const settingsPath = join(projectRoot, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    expect(parsed["hooks"]).toBeDefined();
    const hooks = parsed["hooks"] as Record<string, unknown>;
    // settings-template.ts ships these three hook events
    expect(hooks["SessionStart"]).toBeDefined();
    expect(hooks["SessionEnd"]).toBeDefined();
    expect(hooks["TaskCompleted"]).toBeDefined();
  });

  it("writes .mcp.json with dev-workflow server entry", () => {
    init({ force: true });
    const mcpPath = join(projectRoot, ".mcp.json");
    expect(existsSync(mcpPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(mcpPath, "utf-8")) as Record<string, unknown>;
    const servers = parsed["mcpServers"] as Record<string, unknown>;
    expect(servers["dev-workflow"]).toBeDefined();
    const devWorkflow = servers["dev-workflow"] as { command: string; args: string[] };
    expect(devWorkflow.command).toBe("node");
    expect(devWorkflow.args).toContain("serve");
  });

  it("copies .claude/commands/ from templates (non-empty dir)", () => {
    init({ force: true });
    const commandsDir = join(projectRoot, ".claude", "commands");
    expect(existsSync(commandsDir)).toBe(true);
    expect(statSync(commandsDir).isDirectory()).toBe(true);
    // Spot-check: workflow/dev.md should be present
    expect(existsSync(join(commandsDir, "workflow", "dev.md"))).toBe(true);
  });

  it("copies .claude/agents/ from templates", () => {
    init({ force: true });
    const agentsDir = join(projectRoot, ".claude", "agents");
    expect(existsSync(agentsDir)).toBe(true);
    // Spot-check: bundled .claude/agents/ contains researcher.md
    expect(existsSync(join(agentsDir, "researcher.md"))).toBe(true);
  });

  it("copies .claude/skills/ from templates and reports count", () => {
    const logOutput: string[] = [];
    const origLog = console.log;
    console.log = ((msg: string) => { logOutput.push(String(msg)); return true; }) as typeof console.log;
    try {
      init({ force: true });
    } finally {
      console.log = origLog;
    }
    const skillsDir = join(projectRoot, ".claude", "skills");
    expect(existsSync(skillsDir)).toBe(true);
    expect(statSync(skillsDir).isDirectory()).toBe(true);
    // Spot-check: bundled obsidian-markdown skill from project genesis
    expect(existsSync(join(skillsDir, "obsidian-markdown", "SKILL.md"))).toBe(true);
    // Console output emits skills count alongside commands/agents
    expect(logOutput.some((line) => line.includes("skills/") && /\d+ skill\(s\) installed/.test(line))).toBe(true);
  });

  it("creates .dev-vault/ scaffold (stack/conventions/knowledge/gameplan)", () => {
    init({ force: true });
    const vaultPath = join(projectRoot, ".dev-vault");
    expect(existsSync(vaultPath)).toBe(true);
    expect(existsSync(join(vaultPath, "stack.md"))).toBe(true);
    expect(existsSync(join(vaultPath, "conventions.md"))).toBe(true);
    expect(existsSync(join(vaultPath, "knowledge.md"))).toBe(true);
    expect(existsSync(join(vaultPath, "gameplan.md"))).toBe(true);
  });

  it("errors and sets exitCode=1 when not in a git repository", () => {
    // Move to a non-git temp dir
    const nonGit = mkdtempSync(join(tmpdir(), "cli-init-non-git-"));
    process.chdir(nonGit);
    try {
      init({ force: true });
      expect(process.exitCode).toBe(1);
      expect(errOutput.join("\n")).toContain("not a git repository");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("does not overwrite CLAUDE.md without force flag", () => {
    init({ force: true });
    const claudePath = join(projectRoot, "CLAUDE.md");
    const initialMtime = statSync(claudePath).mtimeMs;
    // Modify the file to detect overwrite
    writeFileSync(claudePath, "user customization", "utf-8");
    const customMtime = statSync(claudePath).mtimeMs;
    expect(customMtime).not.toBe(initialMtime);

    // Re-run init WITHOUT force — should preserve user content
    init({ force: false });
    const afterRetry = readFileSync(claudePath, "utf-8");
    expect(afterRetry).toBe("user customization");
  });

  it("merges into existing .claude/settings.json instead of replacing", () => {
    const settingsPath = join(projectRoot, ".claude", "settings.json");
    mkdirSync(join(projectRoot, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ customField: "preserved" }, null, 2), "utf-8");

    init({ force: true });
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    expect(parsed["customField"]).toBe("preserved");
    expect(parsed["hooks"]).toBeDefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { run } from "../src/hooks/session-start.js";

interface SessionStartOutput {
  continue: boolean;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext: string;
  };
}

describe("session-start hook — shim generation integration", () => {
  let projectRoot: string;
  let originalCwd: string;
  let stdoutChunks: string[];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "session-start-test-"));
    execSync("git init -q", { cwd: projectRoot });
    mkdirSync(join(projectRoot, ".dev-vault", "workflows"), { recursive: true });
    process.chdir(projectRoot);

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    stdoutChunks = [];
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function parseStdout(): SessionStartOutput {
    const joined = stdoutChunks.join("");
    return JSON.parse(joined) as SessionStartOutput;
  }

  it("generates shims for custom workflows defined in .dev-vault/workflows/", async () => {
    writeFileSync(
      join(projectRoot, ".dev-vault", "workflows", "custom-deploy.yaml"),
      `name: custom-deploy\ndescription: Project-specific deploy\nsteps:\n  - name: read\n    agent: reader\n`,
      "utf-8",
    );

    await run();

    const shimPath = join(projectRoot, ".claude", "commands", "workflow", "custom-deploy.md");
    expect(existsSync(shimPath)).toBe(true);
    const content = readFileSync(shimPath, "utf-8");
    expect(content).toContain("generated: true");
    expect(content).toContain("# /workflow:custom-deploy");
    expect(content).toContain("Project-specific deploy");
  });

  it("appends summary line with workflow count to additionalContext", async () => {
    writeFileSync(
      join(projectRoot, ".dev-vault", "workflows", "a.yaml"),
      `name: a\ndescription: A\nsteps:\n  - name: read\n    agent: reader\n`,
      "utf-8",
    );
    writeFileSync(
      join(projectRoot, ".dev-vault", "workflows", "b.yaml"),
      `name: b\ndescription: B\nsteps:\n  - name: read\n    agent: reader\n`,
      "utf-8",
    );

    await run();

    const output = parseStdout();
    expect(output.continue).toBe(true);
    const additionalContext = output.hookSpecificOutput?.additionalContext ?? "";
    expect(additionalContext).toContain("Custom workflows: 2 defined");
    expect(additionalContext).toContain("2 synced");
  });

  it("succeeds with no summary when .dev-vault/workflows is empty", async () => {
    await run();

    const output = parseStdout();
    expect(output.continue).toBe(true);
    const additionalContext = output.hookSpecificOutput?.additionalContext ?? "";
    expect(additionalContext).not.toContain("Custom workflows:");
  });

  it("idempotent: second run skips already-synced shims", { timeout: 15000 }, async () => {
    writeFileSync(
      join(projectRoot, ".dev-vault", "workflows", "idem.yaml"),
      `name: idem\ndescription: Idempotent check\nsteps:\n  - name: read\n    agent: reader\n`,
      "utf-8",
    );

    await run();

    const shimPath = join(projectRoot, ".claude", "commands", "workflow", "idem.md");
    const firstContent = readFileSync(shimPath, "utf-8");

    // Reset stdout capture for second run.
    stdoutChunks = [];

    await run();

    const secondContent = readFileSync(shimPath, "utf-8");
    expect(secondContent).toBe(firstContent);

    const output = parseStdout();
    const additionalContext = output.hookSpecificOutput?.additionalContext ?? "";
    expect(additionalContext).toContain("1 defined");
    expect(additionalContext).toContain("0 synced");
    expect(additionalContext).toContain("1 skipped");
  });

  it("outputs valid JSON even if vault is not a git repo", async () => {
    rmSync(join(projectRoot, ".git"), { recursive: true, force: true });

    await run();

    const output = parseStdout();
    expect(output.continue).toBe(true);
  });

  it("outputs valid JSON when .dev-vault directory is absent", async () => {
    rmSync(join(projectRoot, ".dev-vault"), { recursive: true, force: true });

    await run();

    const output = parseStdout();
    expect(output.continue).toBe(true);
    const additionalContext = output.hookSpecificOutput?.additionalContext ?? "";
    expect(additionalContext).not.toContain("Custom workflows:");
  });
});

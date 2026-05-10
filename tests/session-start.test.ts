import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { run } from "../src/hooks/session-start.js";
import { hashString, formatHash } from "../src/lib/spec-hash.js";

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
  let originalEngramSocket: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
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
    if (originalEngramSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEngramSocket;
    }
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

describe("session-start hook — SPEC drift warning", () => {
  let projectRoot: string;
  let originalCwd: string;
  let stdoutChunks: string[];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalIsTTY: boolean | undefined;
  let originalEngramSocket: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    projectRoot = mkdtempSync(join(tmpdir(), "session-start-spec-drift-"));
    execSync("git init -q", { cwd: projectRoot });
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
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
    if (originalEngramSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEngramSocket;
    }
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function additionalContext(): string {
    const joined = stdoutChunks.join("");
    const parsed = JSON.parse(joined) as {
      continue: boolean;
      hookSpecificOutput?: { additionalContext?: string };
    };
    return parsed.hookSpecificOutput?.additionalContext ?? "";
  }

  it("no SPEC.md — no drift warning", async () => {
    writeFileSync(
      join(projectRoot, ".dev-vault", "gameplan.md"),
      "---\nspec-hash: sha256:0000000000000000000000000000000000000000000000000000000000000000\n---\n# Gameplan\n",
      "utf-8",
    );

    await run();

    const ctx = additionalContext();
    expect(ctx).not.toContain("SPEC.md changed");
    expect(ctx).not.toContain("malformed");
  });

  it("no gameplan.md — no drift warning", async () => {
    writeFileSync(join(projectRoot, "SPEC.md"), "# Stack\n- TypeScript\n", "utf-8");

    await run();

    const ctx = additionalContext();
    expect(ctx).not.toContain("SPEC.md changed");
    expect(ctx).not.toContain("malformed");
  });

  it("matching hash — no drift warning", async () => {
    const specContent = "# Stack\n- TypeScript 5.4\n";
    writeFileSync(join(projectRoot, "SPEC.md"), specContent, "utf-8");
    const expectedHash = formatHash(hashString(specContent));
    writeFileSync(
      join(projectRoot, ".dev-vault", "gameplan.md"),
      `---\nspec-hash: ${expectedHash}\n---\n# Gameplan\n`,
      "utf-8",
    );

    await run();

    const ctx = additionalContext();
    expect(ctx).not.toContain("SPEC.md changed");
    expect(ctx).not.toContain("malformed");
  });

  it("hash mismatch — emits 'SPEC.md changed since last' warning", async () => {
    writeFileSync(join(projectRoot, "SPEC.md"), "# Stack\n- TypeScript 5.4\n", "utf-8");
    writeFileSync(
      join(projectRoot, ".dev-vault", "gameplan.md"),
      "---\nspec-hash: sha256:1111111111111111111111111111111111111111111111111111111111111111\n---\n# Gameplan\n",
      "utf-8",
    );

    await run();

    const ctx = additionalContext();
    expect(ctx).toContain("SPEC.md changed since last");
  });

  it("malformed stored hash — emits 'malformed' warning", async () => {
    writeFileSync(join(projectRoot, "SPEC.md"), "# Stack\n- TS\n", "utf-8");
    writeFileSync(
      join(projectRoot, ".dev-vault", "gameplan.md"),
      "---\nspec-hash: not-a-hash\n---\n# Gameplan\n",
      "utf-8",
    );

    await run();

    const ctx = additionalContext();
    expect(ctx).toContain("malformed");
    expect(ctx).not.toContain("SPEC.md changed since last");
  });
});

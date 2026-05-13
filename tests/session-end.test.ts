import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { run } from "../src/hooks/session-end.js";
import type { WorkflowRun } from "../src/workflow/types.js";

function writeRun(vaultPath: string, run: WorkflowRun): void {
  const dir = join(vaultPath, "workflow-state", "runs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${run.id}.json`), JSON.stringify(run, null, 2), "utf-8");
}

function baseRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-test",
    workflowName: "dev",
    taskId: null,
    taskDescription: "test",
    currentStep: "verify",
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
    steps: {},
    ...overrides,
  };
}

describe("session-end hook — telemetry summary and warnings", () => {
  let projectRoot: string;
  let originalCwd: string;
  let originalIsTTY: boolean | undefined;
  let originalEngramSocket: string | undefined;
  let stderrChunks: string[];
  let stdoutChunks: string[];
  let originalStderrWrite: typeof process.stderr.write;
  let originalStdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    projectRoot = mkdtempSync(join(tmpdir(), "session-end-test-"));
    execSync("git init -q", { cwd: projectRoot });
    mkdirSync(join(projectRoot, ".dev-vault", "workflow-state", "runs"), { recursive: true });
    // scaffold minimal vault so VaultReader.exists() returns true
    writeFileSync(join(projectRoot, ".dev-vault", "stack.md"), "# Stack\n", "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "knowledge.md"), "# Knowledge\n", "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "conventions.md"), "# Conventions\n", "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "gameplan.md"), "# Gameplan\n", "utf-8");
    process.chdir(projectRoot);

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    stderrChunks = [];
    stdoutChunks = [];
    originalStderrWrite = process.stderr.write;
    originalStdoutWrite = process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
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

  it("emits warning when vaultRecord>0 and store=0 (auto-mirror down)", async () => {
    writeRun(join(projectRoot, ".dev-vault"), baseRun({
      telemetry: { search: 1, store: 0, judge: 0, vaultRecord: 3, skipped: 0 },
    }));

    await run();

    const stderr = stderrChunks.join("");
    expect(stderr).toContain("[engram] Session telemetry: search=1 store=0 judge=0 vaultRecord=3 skipped=0");
    expect(stderr).toContain("3 vault records but 0 engram stores");
  });

  it("emits warning when search>=3 and store=0 and vaultRecord=0 (mid-work skip)", async () => {
    writeRun(join(projectRoot, ".dev-vault"), baseRun({
      telemetry: { search: 5, store: 0, judge: 0, vaultRecord: 0, skipped: 0 },
    }));

    await run();

    const stderr = stderrChunks.join("");
    expect(stderr).toContain("5 searches without any store");
    expect(stderr).toContain("Store discoveries mid-work");
  });

  it("emits summary only (no warning) on healthy telemetry", async () => {
    writeRun(join(projectRoot, ".dev-vault"), baseRun({
      telemetry: { search: 5, store: 5, judge: 3, vaultRecord: 2, skipped: 0 },
    }));

    await run();

    const stderr = stderrChunks.join("");
    expect(stderr).toContain("Session telemetry");
    expect(stderr).not.toContain("WARNING");
  });

  it("emits no telemetry summary when run has no telemetry field (legacy run)", async () => {
    writeRun(join(projectRoot, ".dev-vault"), baseRun());

    await run();

    const stderr = stderrChunks.join("");
    expect(stderr).not.toContain("[engram] Session telemetry");
    expect(stderr).not.toContain("WARNING");
  });

  it("emits no warning when there is no current run at all", async () => {
    // No run files written
    await run();

    const stderr = stderrChunks.join("");
    expect(stderr).not.toContain("[engram] Session telemetry");
    expect(stderr).not.toContain("WARNING");
  });

  it("warns only once when both conditions could match (vaultRecord wins)", async () => {
    writeRun(join(projectRoot, ".dev-vault"), baseRun({
      telemetry: { search: 5, store: 0, judge: 0, vaultRecord: 2, skipped: 0 },
    }));

    await run();

    const stderr = stderrChunks.join("");
    expect(stderr).toContain("2 vault records but 0 engram stores");
    expect(stderr).not.toContain("searches without any store");
  });
});

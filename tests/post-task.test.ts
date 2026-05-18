import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { run } from "../src/hooks/post-task.js";

const TODAY = new Date().toISOString().slice(0, 10);

describe("post-task hook", () => {
  let projectRoot: string;
  let originalCwd: string;
  let originalIsTTY: boolean | undefined;
  let originalEngramSocket: string | undefined;
  let stdoutChunks: string[];
  let originalStdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    projectRoot = mkdtempSync(join(tmpdir(), "post-task-test-"));

    // stdin forced to TTY so readStdin() resolves {} immediately (no 3s wait,
    // no data injection) — exercises the task_subject ?? "unknown task" fallback.
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

  it("appends a task-completed line to the daily log when a vault exists", async () => {
    execSync("git init -q", { cwd: projectRoot });
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    process.chdir(projectRoot);

    await run();

    const dailyLog = join(projectRoot, ".dev-vault", "daily", `${TODAY}.md`);
    expect(existsSync(dailyLog)).toBe(true);
    expect(readFileSync(dailyLog, "utf-8")).toContain("Task completed");
    // readStdin resolved {} (TTY) → no task_subject → fallback used.
    expect(readFileSync(dailyLog, "utf-8")).toContain("unknown task");
  });

  it("does not write a daily log when the project has no vault", async () => {
    execSync("git init -q", { cwd: projectRoot });
    process.chdir(projectRoot);

    await expect(run()).resolves.toBeUndefined();

    expect(existsSync(join(projectRoot, ".dev-vault"))).toBe(false);
  });

  it("skips silently when run outside any project (no context)", async () => {
    // No `git init`, no `.dev-vault/` — detectContext walks up to the
    // filesystem root, finds no project marker, returns null.
    process.chdir(projectRoot);

    await expect(run()).resolves.toBeUndefined();

    expect(existsSync(join(projectRoot, ".dev-vault"))).toBe(false);
  });
});

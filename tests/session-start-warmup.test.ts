import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

vi.mock("../src/lib/engram.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/engram.js")>(
    "../src/lib/engram.js",
  );
  return {
    ...actual,
    engramSearch: vi.fn(async () => []),
    engramHealth: vi.fn(async () => null),
    isEngramAvailable: vi.fn(() => false),
  };
});

import { engramSearch, engramHealth } from "../src/lib/engram.js";
import { run as runSessionStart } from "../src/hooks/session-start.js";

describe("session-start hook — engram warmup", () => {
  let projectRoot: string;
  let originalCwd: string;
  let originalIsTTY: boolean | undefined;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalEngramSocket: string | undefined;

  beforeEach(() => {
    vi.mocked(engramSearch).mockClear();
    vi.mocked(engramSearch).mockResolvedValue([]);
    vi.mocked(engramHealth).mockClear();
    vi.mocked(engramHealth).mockResolvedValue(null);

    originalCwd = process.cwd();
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    projectRoot = mkdtempSync(join(tmpdir(), "session-start-warmup-"));
    execSync("git init -q", { cwd: projectRoot });
    mkdirSync(join(projectRoot, ".dev-vault", "workflows"), { recursive: true });
    process.chdir(projectRoot);

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    originalStdoutWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
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

  it("calls engramSearch with warmup query", async () => {
    await runSessionStart();

    const warmupCalls = vi.mocked(engramSearch).mock.calls.filter(
      (call) => call[0] === "warmup",
    );
    expect(warmupCalls.length).toBeGreaterThanOrEqual(1);
    const firstWarmup = warmupCalls[0]!;
    expect(firstWarmup[0]).toBe("warmup");
    expect(firstWarmup[1]).toBeUndefined();
    expect(firstWarmup[2]).toBe(1);
  });

  it("does not crash when warmup engramSearch rejects", async () => {
    vi.mocked(engramSearch).mockImplementation(async (query) => {
      if (query === "warmup") throw new Error("warmup failed");
      return [];
    });

    await expect(runSessionStart()).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { tokens } from "../src/cli/tokens.js";
import type { TokenTraceRecord } from "../src/lib/token-trace.js";

describe("tokens CLI — E2E", () => {
  let projectRoot: string;
  let vaultPath: string;
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
    projectRoot = mkdtempSync(join(tmpdir(), "cli-tokens-test-"));
    vaultPath = join(projectRoot, ".dev-vault");
    process.chdir(projectRoot);

    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "tokens-test" }), "utf-8");

    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });

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
    if (originalEngramSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEngramSocket;
    }
  });

  function logJoined(): string { return logOutput.join("\n"); }
  function errJoined(): string { return errOutput.join("\n"); }

  function record(overrides: Partial<TokenTraceRecord> = {}): TokenTraceRecord {
    return {
      runId: "run-1",
      step: "code",
      timestamp: "2026-05-26T10:00:00.000Z",
      source: "vault_read",
      payload: {},
      tokens: 100,
      chars: 400,
      ...overrides,
    };
  }

  function writeTrace(runId: string, records: TokenTraceRecord[]): void {
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(
      join(vaultPath, "workflow-state", "runs", `${runId}.tokens.jsonl`),
      content,
      "utf-8",
    );
  }

  it("not a dev-workflow project: error + exitCode 1", () => {
    const nonProject = mkdtempSync(join(tmpdir(), "cli-tokens-nonproject-"));
    process.chdir(nonProject);
    try {
      tokens(["analyze"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Not a dev-workflow project (no .dev-vault/ found).");
    } finally {
      process.chdir(projectRoot);
      rmSync(nonProject, { recursive: true, force: true });
    }
  });

  it("analyze with no traces: 'No token traces found.' + exitCode 1", () => {
    tokens(["analyze"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("No token traces found.");
    expect(logJoined()).toBe("");
  });

  it("analyze no-arg: prints all section headers including engram-type placeholder", () => {
    writeTrace("run-x", [
      record({ source: "vault_read", payload: { path: "stack.md" }, tokens: 300, step: "read" }),
      record({ source: "memory_search", payload: { query: "how to test" }, tokens: 120, step: "code" }),
      record({ source: "memory_judge", payload: { memoryId: "m-1" }, tokens: 40, step: "code" }),
    ]);
    tokens(["analyze"]);
    const out = logJoined();
    expect(process.exitCode).not.toBe(1);
    expect(out).toContain("By step");
    expect(out).toContain("By source");
    expect(out).toContain("By vault file");
    expect(out).toContain("By engram type");
    expect(out).toContain("(no engram type data)");
    expect(out).toContain("stack.md");
  });

  it("analyze with explicit runId selects that run", () => {
    writeTrace("run-aaaaaaaaaaaa", [record({ runId: "run-aaaaaaaaaaaa", tokens: 100 })]);
    writeTrace("run-bbbbbbbbbbbb", [record({ runId: "run-bbbbbbbbbbbb", tokens: 999 })]);
    tokens(["analyze", "run-aaaaaaaaaaaa"]);
    const out = logJoined();
    expect(out).toContain("run-aaaaaaaaaaaa");
    expect(out).not.toContain("999");
  });

  it("analyze with missing runId: 'Token trace not found' + exitCode 1", () => {
    writeTrace("run-aaaaaaaaaaaa", [record()]);
    tokens(["analyze", "run-bbbbbbbbbbbb"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("Token trace not found:");
    expect(errJoined()).toContain("run-bbbbbbbbbbbb.tokens.jsonl");
  });

  it("analyze --json: emits valid JSON with stable keys, no pretty output", () => {
    writeTrace("run-json", [
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 200 }),
    ]);
    tokens(["analyze", "--json"]);
    const json = JSON.parse(logJoined()) as Record<string, unknown>;
    expect(json["runId"]).toBeDefined();
    expect(json["totalTokens"]).toBe(200);
    expect(json["byStep"]).toBeDefined();
    expect(json["bySource"]).toBeDefined();
    expect(json["byVaultFile"]).toBeDefined();
    expect(json["byEngramType"]).toEqual([]);
    expect(json["warnings"]).toBeDefined();
  });

  it("analyze --all: pools across runs under '(all runs)'", () => {
    writeTrace("run-a", [record({ runId: "run-a", tokens: 100 })]);
    writeTrace("run-b", [record({ runId: "run-b", tokens: 200 })]);
    tokens(["analyze", "--all"]);
    const out = logJoined();
    expect(out).toContain("(all runs)");
  });

  it("analyze --all with no files: 'No token traces found.' + exitCode 1", () => {
    tokens(["analyze", "--all"]);
    expect(process.exitCode).toBe(1);
    expect(errJoined()).toContain("No token traces found.");
    expect(logJoined()).toBe("");
  });

  it("compare: prints deltas and flags growth", () => {
    writeTrace("run-aaaaaaaaaaaa", [record({ runId: "run-aaaaaaaaaaaa", step: "code", tokens: 100 })]);
    writeTrace("run-bbbbbbbbbbbb", [record({ runId: "run-bbbbbbbbbbbb", step: "code", tokens: 200 })]);
    tokens(["compare", "run-aaaaaaaaaaaa", "run-bbbbbbbbbbbb"]);
    const out = logJoined();
    expect(out).toContain("run-aaaaaaaaaaaa");
    expect(out).toContain("run-bbbbbbbbbbbb");
    expect(out).toContain("⚠");
  });

  it("compare with <2 args: usage + exitCode 1", () => {
    writeTrace("run-aaaaaaaaaaaa", [record({ runId: "run-aaaaaaaaaaaa" })]);
    tokens(["compare", "run-aaaaaaaaaaaa"]);
    expect(process.exitCode).toBe(1);
    expect(logJoined()).toBe("");
  });

  it("tail: prints last N records; --lines bounds the count", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      record({ source: "vault_read", payload: { path: `file-${i}.md` }, tokens: i + 1 }),
    );
    writeTrace("run-aaaaaaaaaaaa", many);
    tokens(["tail", "run-aaaaaaaaaaaa", "--lines", "2"]);
    const out = logJoined();
    expect(out).toContain("file-4.md");
    expect(out).toContain("file-3.md");
    expect(out).not.toContain("file-2.md");
    expect(out.split("\n").filter((l) => l.includes("file-")).length).toBe(2);
  });

  describe("run id validation (path traversal guard)", () => {
    it("analyze with a traversal run id: 'Invalid run id' + exitCode 1, no path echoed", () => {
      tokens(["analyze", "../../etc/passwd"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Invalid run id: ../../etc/passwd");
      expect(errJoined()).not.toContain(".tokens.jsonl");
      expect(logJoined()).toBe("");
    });

    it("compare with a traversal run id: 'Invalid run id' + exitCode 1", () => {
      writeTrace("run-aaaaaaaaaaaa", [record({ runId: "run-aaaaaaaaaaaa" })]);
      tokens(["compare", "run-aaaaaaaaaaaa", "../../../../some/path"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Invalid run id: ../../../../some/path");
      expect(logJoined()).toBe("");
    });

    it("tail with a traversal run id: 'Invalid run id' + exitCode 1", () => {
      tokens(["tail", "../secret"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Invalid run id: ../secret");
    });

    it("accepts a canonical run-<12hex> id", () => {
      writeTrace("run-0123456789ab", [record({ runId: "run-0123456789ab", tokens: 42 })]);
      tokens(["analyze", "run-0123456789ab"]);
      expect(process.exitCode).not.toBe(1);
      expect(logJoined()).toContain("run-0123456789ab");
    });

    it("accepts the 'orphan' sentinel run id", () => {
      writeFileSync(
        join(vaultPath, "workflow-state", "orphan-tokens.jsonl"),
        JSON.stringify(record({ runId: "orphan", tokens: 7 })) + "\n",
        "utf-8",
      );
      tokens(["analyze", "orphan"]);
      expect(process.exitCode).not.toBe(1);
      expect(logJoined()).toContain("orphan");
    });
  });

  describe("error and edge paths", () => {
    it("analyze on a non-empty but record-less trace: 'No token records in run' + exitCode 1", () => {
      writeFileSync(
        join(vaultPath, "workflow-state", "runs", "run-aaaaaaaaaaaa.tokens.jsonl"),
        "\n\n",
        "utf-8",
      );
      tokens(["analyze", "run-aaaaaaaaaaaa"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("No token records in run run-aaaaaaaaaaaa.");
    });

    it("unknown subcommand: usage + exitCode 1", () => {
      tokens(["bogus"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Usage: dev-workflow tokens analyze|compare|tail");
    });

    it("no subcommand: usage + exitCode 1", () => {
      tokens([]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Usage: dev-workflow tokens analyze|compare|tail");
    });

    it("non-ENOENT read failure (EISDIR): 'Failed to read token trace:'", () => {
      mkdirSync(join(vaultPath, "workflow-state", "runs", "run-aaaaaaaaaaaa.tokens.jsonl"));
      tokens(["analyze", "run-aaaaaaaaaaaa"]);
      expect(process.exitCode).toBe(1);
      expect(errJoined()).toContain("Failed to read token trace:");
    });
  });

  describe("formatter coverage", () => {
    it("renders a multi-hour duration line (not '—'/'0ms')", () => {
      writeTrace("run-cccccccccccc", [
        record({ runId: "run-cccccccccccc", timestamp: "2026-05-26T10:00:00.000Z", tokens: 100 }),
        record({ runId: "run-cccccccccccc", timestamp: "2026-05-26T11:30:00.000Z", tokens: 200 }),
      ]);
      tokens(["analyze", "run-cccccccccccc"]);
      const out = logJoined();
      expect(out).toMatch(/Duration: 1h(30m)?/);
      expect(out).not.toContain("Duration: —");
    });

    it("renders memory types under 'By engram type'", () => {
      writeTrace("run-dddddddddddd", [
        record({
          runId: "run-dddddddddddd",
          source: "memory_search",
          payload: { query: "q", memoryType: "bugfix" },
          tokens: 120,
        }),
      ]);
      tokens(["analyze", "run-dddddddddddd"]);
      const out = logJoined();
      expect(out).toContain("By engram type");
      expect(out).not.toContain("(no engram type data)");
      expect(out).toContain("bugfix");
    });

    it("compare: a <11% delta step is not flagged", () => {
      writeTrace("run-aaaaaaaaaaaa", [record({ runId: "run-aaaaaaaaaaaa", step: "code", tokens: 100 })]);
      writeTrace("run-bbbbbbbbbbbb", [record({ runId: "run-bbbbbbbbbbbb", step: "code", tokens: 105 })]);
      tokens(["compare", "run-aaaaaaaaaaaa", "run-bbbbbbbbbbbb"]);
      const out = logJoined();
      const codeLine = out.split("\n").find((line) => line.includes("code"))!;
      expect(codeLine).not.toContain("⚠");
    });

    it("compare --json: emits runA/runB/steps", () => {
      writeTrace("run-aaaaaaaaaaaa", [record({ runId: "run-aaaaaaaaaaaa", step: "code", tokens: 100 })]);
      writeTrace("run-bbbbbbbbbbbb", [record({ runId: "run-bbbbbbbbbbbb", step: "code", tokens: 105 })]);
      tokens(["compare", "run-aaaaaaaaaaaa", "run-bbbbbbbbbbbb", "--json"]);
      const json = JSON.parse(logJoined()) as Record<string, unknown>;
      expect(json["runA"]).toBe("run-aaaaaaaaaaaa");
      expect(json["runB"]).toBe("run-bbbbbbbbbbbb");
      expect(json["steps"]).toBeDefined();
    });

    it("tail: renders memoryId and query hints", () => {
      writeTrace("run-eeeeeeeeeeee", [
        record({ runId: "run-eeeeeeeeeeee", source: "memory_judge", payload: { memoryId: "mem-xyz" } }),
        record({ runId: "run-eeeeeeeeeeee", source: "memory_search", payload: { query: "how does the engram cache work" } }),
      ]);
      tokens(["tail", "run-eeeeeeeeeeee"]);
      const out = logJoined();
      expect(out).toContain("mem-xyz");
      expect(out).toContain("how does the engram cache work");
    });

    it("tail with no --lines: defaults to last 20 records", () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        record({ runId: "run-ffffffffffff", source: "vault_read", payload: { path: `f-${i}.md` }, tokens: i + 1 }),
      );
      writeTrace("run-ffffffffffff", many);
      tokens(["tail", "run-ffffffffffff"]);
      const rendered = logOutput.filter((line) => line.includes("f-"));
      expect(rendered.length).toBe(20);
      expect(logJoined()).toContain("f-24.md");
      expect(logJoined()).not.toContain("f-4.md");
    });

    it("tail --lines 0: falls back to the default count", () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        record({ runId: "run-ffffffffffff", source: "vault_read", payload: { path: `f-${i}.md` }, tokens: i + 1 }),
      );
      writeTrace("run-ffffffffffff", many);
      tokens(["tail", "run-ffffffffffff", "--lines", "0"]);
      const rendered = logOutput.filter((line) => line.includes("f-"));
      expect(rendered.length).toBe(20);
    });
  });
});

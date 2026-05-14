import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:net";
import {
  appendEngramTrace,
  type EngramTraceEvent,
} from "../src/lib/engram-trace.js";
import { engramTrace } from "../src/cli/engram-trace.js";
import { engramSearch } from "../src/lib/engram.js";

const SHORT_TEMP_ROOT = "/tmp";

function freshSocketPath(prefix: string): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return join(SHORT_TEMP_ROOT, `${prefix}-${process.pid}-${id}.sock`);
}

async function createMockEngramServer(
  socketPath: string,
  responder: (request: { method: string; params: unknown }) => unknown,
): Promise<Server> {
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const request = JSON.parse(buffer.slice(0, newlineIndex)) as {
        method: string;
        params: unknown;
      };
      const response = responder(request);
      socket.write(JSON.stringify(response) + "\n");
      socket.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
    server.listen(socketPath);
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function makeEvent(overrides: Partial<EngramTraceEvent> = {}): EngramTraceEvent {
  return {
    ts: "2026-05-01T10:00:00.000Z",
    method: "memory_search",
    params: { query: "x" },
    ok: true,
    response_summary: "[]",
    duration_ms: 12,
    ...overrides,
  };
}

describe("appendEngramTrace", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["ENGRAM_TRACE_FILE"];
    tempDir = mkdtempSync(join(tmpdir(), "engram-trace-test-"));
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["ENGRAM_TRACE_FILE"];
    } else {
      process.env["ENGRAM_TRACE_FILE"] = originalEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes JSONL line when ENGRAM_TRACE_FILE is set", () => {
    const tracePath = join(tempDir, "trace.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = tracePath;

    appendEngramTrace(makeEvent({ method: "memory_store", duration_ms: 7 }));

    expect(existsSync(tracePath)).toBe(true);
    const content = readFileSync(tracePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as EngramTraceEvent;
    expect(parsed.method).toBe("memory_store");
    expect(parsed.duration_ms).toBe(7);
    expect(parsed.ok).toBe(true);
  });

  it("is a no-op when ENGRAM_TRACE_FILE is unset", () => {
    delete process.env["ENGRAM_TRACE_FILE"];
    const tracePath = join(tempDir, "should-not-exist.jsonl");

    appendEngramTrace(makeEvent());

    expect(existsSync(tracePath)).toBe(false);
  });

  it("creates parent directory lazily for nested paths", () => {
    const tracePath = join(tempDir, "a", "b", "c", "trace.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = tracePath;

    appendEngramTrace(makeEvent());

    expect(existsSync(tracePath)).toBe(true);
  });

  it("silently swallows write errors when path is invalid", () => {
    const blockerFile = join(tempDir, "blocker");
    writeFileSync(blockerFile, "regular file", "utf-8");
    // blocker is a regular file, so treating it as a directory must fail
    const tracePath = join(blockerFile, "trace.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = tracePath;

    expect(() => appendEngramTrace(makeEvent())).not.toThrow();
    expect(existsSync(tracePath)).toBe(false);
  });

  it("appends multiple events as separate lines", () => {
    const tracePath = join(tempDir, "multi.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = tracePath;

    appendEngramTrace(makeEvent({ method: "memory_search" }));
    appendEngramTrace(makeEvent({ method: "memory_store", ok: false, error: "oops" }));

    const lines = readFileSync(tracePath, "utf-8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    const second = JSON.parse(lines[1]!) as EngramTraceEvent;
    expect(second.ok).toBe(false);
    expect(second.error).toBe("oops");
  });

  describe("ENGRAM_STEP top-level field (Option B from 2026-05-14 debt)", () => {
    let originalStep: string | undefined;

    beforeEach(() => {
      originalStep = process.env["ENGRAM_STEP"];
    });

    afterEach(() => {
      if (originalStep === undefined) {
        delete process.env["ENGRAM_STEP"];
      } else {
        process.env["ENGRAM_STEP"] = originalStep;
      }
    });

    it("populates event.step from ENGRAM_STEP env when set", () => {
      const tracePath = join(tempDir, "step.jsonl");
      process.env["ENGRAM_TRACE_FILE"] = tracePath;
      process.env["ENGRAM_STEP"] = "read";

      appendEngramTrace(makeEvent({ method: "memory_search" }));

      const parsed = JSON.parse(
        readFileSync(tracePath, "utf-8").split("\n")[0]!,
      ) as EngramTraceEvent;
      expect(parsed.step).toBe("read");
    });

    it("omits step field when ENGRAM_STEP is unset", () => {
      const tracePath = join(tempDir, "no-step.jsonl");
      process.env["ENGRAM_TRACE_FILE"] = tracePath;
      delete process.env["ENGRAM_STEP"];

      appendEngramTrace(makeEvent({ method: "memory_search" }));

      const parsed = JSON.parse(
        readFileSync(tracePath, "utf-8").split("\n")[0]!,
      ) as Record<string, unknown>;
      expect("step" in parsed).toBe(false);
    });

    it("omits step field when ENGRAM_STEP is empty string", () => {
      const tracePath = join(tempDir, "empty-step.jsonl");
      process.env["ENGRAM_TRACE_FILE"] = tracePath;
      process.env["ENGRAM_STEP"] = "";

      appendEngramTrace(makeEvent({ method: "memory_search" }));

      const parsed = JSON.parse(
        readFileSync(tracePath, "utf-8").split("\n")[0]!,
      ) as Record<string, unknown>;
      expect("step" in parsed).toBe(false);
    });

    it("does not mutate the caller's event object", () => {
      const tracePath = join(tempDir, "no-mutate.jsonl");
      process.env["ENGRAM_TRACE_FILE"] = tracePath;
      process.env["ENGRAM_STEP"] = "plan";

      const original = makeEvent({ method: "memory_search" });
      appendEngramTrace(original);

      expect((original as { step?: string }).step).toBeUndefined();
    });
  });
});

describe("engramTrace CLI", () => {
  let projectRoot: string;
  let originalCwd: string;
  let logOutput: string[];
  let errOutput: string[];
  let originalLog: typeof console.log;
  let originalErr: typeof console.error;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-trace-cli-"));
    mkdirSync(join(projectRoot, ".dev-vault"), { recursive: true });
    // git repo so detectContext finds projectRoot
    mkdirSync(join(projectRoot, ".git"), { recursive: true });
    process.chdir(projectRoot);

    logOutput = [];
    errOutput = [];
    originalLog = console.log;
    originalErr = console.error;
    console.log = ((message: string) => {
      logOutput.push(String(message));
      return true;
    }) as typeof console.log;
    console.error = ((message: string) => {
      errOutput.push(String(message));
      return true;
    }) as typeof console.error;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalErr;
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function joinedLog(): string {
    return logOutput.join("\n");
  }

  function joinedErr(): string {
    return errOutput.join("\n");
  }

  function writeFixture(runId: string, events: EngramTraceEvent[]): string {
    const tracePath = join(
      projectRoot,
      ".dev-vault",
      "workflow-state",
      "runs",
      `${runId}.engram-trace.jsonl`,
    );
    mkdirSync(join(projectRoot, ".dev-vault", "workflow-state", "runs"), {
      recursive: true,
    });
    const content = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    writeFileSync(tracePath, content, "utf-8");
    return tracePath;
  }

  it("prints summary for valid trace file", () => {
    writeFixture("run-2026-05-01-001", [
      makeEvent({ method: "memory_search", duration_ms: 10 }),
      makeEvent({ method: "memory_search", duration_ms: 20 }),
      makeEvent({ method: "memory_store", duration_ms: 5, ok: false, error: "boom" }),
    ]);

    engramTrace(["run-2026-05-01-001"]);

    const out = joinedLog();
    expect(out).toContain("Engram trace: run-2026-05-01-001");
    expect(out).toContain("Calls: 3");
    expect(out).toContain("Total duration: 35ms");
    expect(out).toContain("Errors: 1");
    expect(out).toContain("memory_search: 2 calls");
    expect(out).toContain("memory_store: 1 calls");
  });

  it("--raw prints lines verbatim", () => {
    const event = makeEvent({ method: "memory_search", duration_ms: 42 });
    writeFixture("run-2026-05-01-002", [event]);

    engramTrace(["run-2026-05-01-002", "--raw"]);

    expect(joinedLog()).toBe(JSON.stringify(event));
  });

  it("exits 1 with stderr message when trace file is missing", () => {
    engramTrace(["run-2026-05-01-missing"]);

    expect(process.exitCode).toBe(1);
    expect(joinedErr()).toContain("Trace file not found");
  });

  it("exits 1 with usage message when runId argument is missing", () => {
    engramTrace([]);

    expect(process.exitCode).toBe(1);
    expect(joinedErr()).toContain("Usage: dev-workflow engram-trace");
  });

  it("prints summary for empty trace file", () => {
    const tracePath = join(
      projectRoot,
      ".dev-vault",
      "workflow-state",
      "runs",
      "run-empty-001.engram-trace.jsonl",
    );
    mkdirSync(join(projectRoot, ".dev-vault", "workflow-state", "runs"), {
      recursive: true,
    });
    writeFileSync(tracePath, "", "utf-8");

    engramTrace(["run-empty-001"]);

    const out = joinedLog();
    expect(out).toContain("Engram trace: run-empty-001");
    expect(out).toContain("Calls: 0");
    expect(out).toContain("Total duration: 0ms");
    expect(out).toContain("Errors: 0");
  });

  it("--raw on empty trace file prints nothing", () => {
    const tracePath = join(
      projectRoot,
      ".dev-vault",
      "workflow-state",
      "runs",
      "run-empty-002.engram-trace.jsonl",
    );
    mkdirSync(join(projectRoot, ".dev-vault", "workflow-state", "runs"), {
      recursive: true,
    });
    writeFileSync(tracePath, "", "utf-8");

    engramTrace(["run-empty-002", "--raw"]);

    expect(joinedLog()).toBe("");
  });

  it("skips malformed JSONL lines in summary mode", () => {
    const validEvent1 = makeEvent({ method: "memory_search", duration_ms: 10 });
    const validEvent2 = makeEvent({ method: "memory_store", duration_ms: 5 });
    const tracePath = join(
      projectRoot,
      ".dev-vault",
      "workflow-state",
      "runs",
      "run-malformed-001.engram-trace.jsonl",
    );
    mkdirSync(join(projectRoot, ".dev-vault", "workflow-state", "runs"), {
      recursive: true,
    });
    writeFileSync(
      tracePath,
      [
        JSON.stringify(validEvent1),
        "this is not json",
        JSON.stringify(validEvent2),
        "{broken: json}",
      ].join("\n") + "\n",
      "utf-8",
    );

    engramTrace(["run-malformed-001"]);

    const out = joinedLog();
    expect(out).toContain("Calls: 2");
    expect(out).toContain("memory_search: 1 calls");
    expect(out).toContain("memory_store: 1 calls");
  });
});

describe("engramSearch trace integration", () => {
  let socketPath: string;
  let server: Server | null = null;
  let tempDir: string;
  let originalSocketEnv: string | undefined;
  let originalTraceEnv: string | undefined;

  beforeEach(() => {
    originalSocketEnv = process.env["ENGRAM_SOCKET_PATH"];
    originalTraceEnv = process.env["ENGRAM_TRACE_FILE"];
    tempDir = mkdtempSync(join(tmpdir(), "engram-trace-int-"));
    socketPath = freshSocketPath("dv-trace-int");
  });

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
    if (originalSocketEnv === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalSocketEnv;
    }
    if (originalTraceEnv === undefined) {
      delete process.env["ENGRAM_TRACE_FILE"];
    } else {
      process.env["ENGRAM_TRACE_FILE"] = originalTraceEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes ok=true trace event when daemon replies successfully", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: [],
    }));
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;
    const tracePath = join(tempDir, "search.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = tracePath;

    await engramSearch("ping", "proj", 1);

    expect(existsSync(tracePath)).toBe(true);
    const lines = readFileSync(tracePath, "utf-8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!) as EngramTraceEvent;
    expect(event.method).toBe("memory_search");
    expect(event.ok).toBe(true);
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
    expect(event.params["query"]).toBe("ping");
  });

  it("writes ok=false trace event when socket connection fails", async () => {
    process.env["ENGRAM_SOCKET_PATH"] = freshSocketPath("dv-trace-int-no-server");
    const tracePath = join(tempDir, "fail.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = tracePath;

    const result = await engramSearch("ping", "proj", 1);
    expect(result).toEqual([]);

    expect(existsSync(tracePath)).toBe(true);
    const lines = readFileSync(tracePath, "utf-8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const event = JSON.parse(lines[0]!) as EngramTraceEvent;
    expect(event.method).toBe("memory_search");
    expect(event.ok).toBe(false);
    expect(event.error).toBe("socket not found");
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("truncates response_summary to 500 chars in trace event", async () => {
    const largePayload = Array.from({ length: 100 }, (_, i) => ({
      id: `mem-${i}`,
      context: "x".repeat(10),
    }));
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: largePayload,
    }));
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;
    const tracePath = join(tempDir, "truncate.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = tracePath;

    await engramSearch("big", "proj", 100);

    const lines = readFileSync(tracePath, "utf-8")
      .split("\n")
      .filter((line) => line.length > 0);
    const event = JSON.parse(lines[0]!) as EngramTraceEvent;
    expect(event.ok).toBe(true);
    expect(event.response_summary.length).toBe(500);
    expect(JSON.stringify(largePayload).startsWith(event.response_summary)).toBe(true);
  });
});

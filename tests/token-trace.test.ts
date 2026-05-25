import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendTokenTrace,
  type TokenTraceRecord,
} from "../src/lib/token-trace.js";
import * as context from "../src/lib/context.js";

function makeRecord(
  overrides: Partial<Omit<TokenTraceRecord, "runId" | "step" | "timestamp">> = {},
): Omit<TokenTraceRecord, "runId" | "step" | "timestamp"> {
  return {
    source: "memory_search",
    payload: { query: "x" },
    tokens: 42,
    chars: 168,
    ...overrides,
  };
}

describe("appendTokenTrace", () => {
  let tempDir: string;
  let originalTraceFile: string | undefined;
  let originalRunId: string | undefined;
  let originalStep: string | undefined;

  beforeEach(() => {
    originalTraceFile = process.env["ENGRAM_TRACE_FILE"];
    originalRunId = process.env["ENGRAM_RUN_ID"];
    originalStep = process.env["ENGRAM_STEP"];
    tempDir = mkdtempSync(join(tmpdir(), "token-trace-test-"));
  });

  afterEach(() => {
    if (originalTraceFile === undefined) {
      delete process.env["ENGRAM_TRACE_FILE"];
    } else {
      process.env["ENGRAM_TRACE_FILE"] = originalTraceFile;
    }
    if (originalRunId === undefined) {
      delete process.env["ENGRAM_RUN_ID"];
    } else {
      process.env["ENGRAM_RUN_ID"] = originalRunId;
    }
    if (originalStep === undefined) {
      delete process.env["ENGRAM_STEP"];
    } else {
      process.env["ENGRAM_STEP"] = originalStep;
    }
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function activateRun(runId: string): string {
    const traceFile = join(tempDir, "runs", runId + ".engram-trace.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = traceFile;
    process.env["ENGRAM_RUN_ID"] = runId;
    return join(tempDir, "runs", runId + ".tokens.jsonl");
  }

  function readLines(filePath: string): string[] {
    return readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((line) => line.length > 0);
  }

  it("writes a token trace as a sibling of the active-run engram trace", () => {
    const runId = "run-2026-05-25-001";
    const tokensPath = activateRun(runId);

    appendTokenTrace(makeRecord());

    expect(existsSync(tokensPath)).toBe(true);
    const lines = readLines(tokensPath);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as TokenTraceRecord;
    expect(parsed.runId).toBe(runId);
    expect(parsed.source).toBe("memory_search");
    expect(parsed.tokens).toBe(42);
    expect(parsed.chars).toBe(168);
    expect(parsed.payload.query).toBe("x");
  });

  it("appends multiple records as separate lines", () => {
    const tokensPath = activateRun("run-2026-05-25-002");

    appendTokenTrace(makeRecord({ source: "memory_search" }));
    appendTokenTrace(makeRecord({ source: "memory_store", tokens: 10, chars: 40 }));

    const lines = readLines(tokensPath);
    expect(lines).toHaveLength(2);
    const second = JSON.parse(lines[1]!) as TokenTraceRecord;
    expect(second.source).toBe("memory_store");
    expect(second.tokens).toBe(10);
  });

  it("stamps step from ENGRAM_STEP when set", () => {
    const tokensPath = activateRun("run-2026-05-25-003");
    process.env["ENGRAM_STEP"] = "code";

    appendTokenTrace(makeRecord());

    const parsed = JSON.parse(readLines(tokensPath)[0]!) as TokenTraceRecord;
    expect(parsed.step).toBe("code");
  });

  it("stamps step 'unknown' when ENGRAM_STEP is unset", () => {
    const tokensPath = activateRun("run-2026-05-25-004");
    delete process.env["ENGRAM_STEP"];

    appendTokenTrace(makeRecord());

    const parsed = JSON.parse(readLines(tokensPath)[0]!) as TokenTraceRecord;
    expect(parsed.step).toBe("unknown");
  });

  it("stamps step 'unknown' when ENGRAM_STEP is empty string", () => {
    const tokensPath = activateRun("run-2026-05-25-005");
    process.env["ENGRAM_STEP"] = "";

    appendTokenTrace(makeRecord());

    const parsed = JSON.parse(readLines(tokensPath)[0]!) as TokenTraceRecord;
    expect(parsed.step).toBe("unknown");
  });

  it("stamps a parseable timestamp that was not caller-supplied", () => {
    const tokensPath = activateRun("run-2026-05-25-006");

    appendTokenTrace(makeRecord());

    const parsed = JSON.parse(readLines(tokensPath)[0]!) as TokenTraceRecord;
    expect(typeof parsed.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false);
    expect("timestamp" in makeRecord()).toBe(false);
  });

  it("does not mutate the caller's record object", () => {
    activateRun("run-2026-05-25-007");
    process.env["ENGRAM_STEP"] = "review";

    const original = makeRecord();
    appendTokenTrace(original);

    expect("runId" in original).toBe(false);
    expect("step" in original).toBe(false);
    expect("timestamp" in original).toBe(false);
  });

  it("writes an orphan trace via detectContext when no run is active", () => {
    delete process.env["ENGRAM_TRACE_FILE"];
    delete process.env["ENGRAM_RUN_ID"];
    delete process.env["ENGRAM_STEP"];

    const orphanProjectRoot = mkdtempSync(join(tmpdir(), "token-trace-orphan-"));
    mkdirSync(join(orphanProjectRoot, ".git"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(orphanProjectRoot);

    try {
      appendTokenTrace(makeRecord());

      const orphanPath = join(
        orphanProjectRoot,
        ".dev-vault",
        "workflow-state",
        "orphan-tokens.jsonl",
      );
      expect(existsSync(orphanPath)).toBe(true);
      const parsed = JSON.parse(readLines(orphanPath)[0]!) as TokenTraceRecord;
      expect(parsed.runId).toBe("orphan");
      expect(parsed.step).toBe("unknown");
    } finally {
      rmSync(orphanProjectRoot, { recursive: true, force: true });
    }
  });

  it("is a no-op when no run is active and detectContext finds no project", () => {
    delete process.env["ENGRAM_TRACE_FILE"];
    delete process.env["ENGRAM_RUN_ID"];
    delete process.env["ENGRAM_STEP"];

    const noVaultRoot = mkdtempSync(join(tmpdir(), "token-trace-novault-"));
    vi.spyOn(process, "cwd").mockReturnValue(noVaultRoot);

    try {
      expect(() => appendTokenTrace(makeRecord())).not.toThrow();
      const orphanPath = join(
        noVaultRoot,
        ".dev-vault",
        "workflow-state",
        "orphan-tokens.jsonl",
      );
      expect(existsSync(orphanPath)).toBe(false);
    } finally {
      rmSync(noVaultRoot, { recursive: true, force: true });
    }
  });

  it("resolves the orphan vault at most once per cwd and still writes on cache hit", () => {
    delete process.env["ENGRAM_TRACE_FILE"];
    delete process.env["ENGRAM_RUN_ID"];
    delete process.env["ENGRAM_STEP"];

    const projectRoot = mkdtempSync(join(tmpdir(), "token-trace-memo-"));
    mkdirSync(join(projectRoot, ".git"), { recursive: true });
    const detectSpy = vi.spyOn(context, "detectContext");
    vi.spyOn(process, "cwd").mockReturnValue(projectRoot);

    try {
      appendTokenTrace(makeRecord());
      appendTokenTrace(makeRecord());

      expect(detectSpy).toHaveBeenCalledTimes(1); // memo: detectContext once per cwd
      const orphanPath = join(
        projectRoot,
        ".dev-vault",
        "workflow-state",
        "orphan-tokens.jsonl",
      );
      expect(readLines(orphanPath)).toHaveLength(2); // cache hit still writes the 2nd line
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("silently swallows write errors when a blocker file occupies the path", () => {
    const runId = "run-2026-05-25-010";
    const blockerFile = join(tempDir, "runs");
    writeFileSync(blockerFile, "regular file", "utf-8");
    const tokensPath = join(tempDir, "runs", runId + ".tokens.jsonl");
    process.env["ENGRAM_TRACE_FILE"] = join(
      tempDir,
      "runs",
      runId + ".engram-trace.jsonl",
    );
    process.env["ENGRAM_RUN_ID"] = runId;

    expect(() => appendTokenTrace(makeRecord())).not.toThrow();
    expect(existsSync(tokensPath)).toBe(false);
  });

  it("preserves every record across 50 appends without loss or corruption", () => {
    const tokensPath = activateRun("run-2026-05-25-011");
    const total = 50;

    for (let index = 0; index < total; index++) {
      appendTokenTrace(makeRecord({ tokens: index, chars: index * 4 }));
    }

    const lines = readLines(tokensPath);
    expect(lines).toHaveLength(total);
    lines.forEach((line, index) => {
      const parsed = JSON.parse(line) as TokenTraceRecord;
      expect(parsed.tokens).toBe(index);
      expect(parsed.runId).toBe("run-2026-05-25-011");
    });
  });
});

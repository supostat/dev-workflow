import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverTokenRuns,
  mostRecentTokenRun,
  tokenTracePathFor,
  readTokenTrace,
} from "../src/lib/token-trace-store.js";
import type { TokenTraceRecord } from "../src/lib/token-trace.js";

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

describe("discovery — runs and orphan", () => {
  let vaultPath: string;
  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "token-store-disc-"));
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
  });
  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function runsDir(): string {
    return join(vaultPath, "workflow-state", "runs");
  }

  it("mostRecent picks the highest mtime", () => {
    writeFileSync(join(runsDir(), "old.tokens.jsonl"), JSON.stringify(record()) + "\n", "utf-8");
    const future = Date.now() / 1000 + 3600;
    writeFileSync(join(runsDir(), "new.tokens.jsonl"), JSON.stringify(record()) + "\n", "utf-8");
    utimesSync(join(runsDir(), "new.tokens.jsonl"), future, future);
    const recent = mostRecentTokenRun(vaultPath);
    expect(recent?.runId).toBe("new");
  });

  it("drops empty (size 0) trace files", () => {
    writeFileSync(join(runsDir(), "empty.tokens.jsonl"), "", "utf-8");
    writeFileSync(join(runsDir(), "full.tokens.jsonl"), JSON.stringify(record()) + "\n", "utf-8");
    const runs = discoverTokenRuns(vaultPath);
    expect(runs.map((r) => r.runId).sort()).toEqual(["full"]);
  });

  it("discovers the orphan trace with runId 'orphan'", () => {
    writeFileSync(
      join(vaultPath, "workflow-state", "orphan-tokens.jsonl"),
      JSON.stringify(record({ runId: "orphan" })) + "\n",
      "utf-8",
    );
    const runs = discoverTokenRuns(vaultPath);
    expect(runs.some((r) => r.runId === "orphan")).toBe(true);
  });

  it("ignores non-suffix files in runs dir", () => {
    writeFileSync(join(runsDir(), "run-1.json"), "{}", "utf-8");
    writeFileSync(join(runsDir(), "run-1.engram-trace.jsonl"), "{}\n", "utf-8");
    writeFileSync(join(runsDir(), "real.tokens.jsonl"), JSON.stringify(record()) + "\n", "utf-8");
    const runs = discoverTokenRuns(vaultPath);
    expect(runs.map((r) => r.runId)).toEqual(["real"]);
  });

  it("returns empty when no traces and no orphan", () => {
    expect(discoverTokenRuns(vaultPath)).toEqual([]);
    expect(mostRecentTokenRun(vaultPath)).toBeNull();
  });

  it("tokenTracePathFor resolves orphan vs run paths", () => {
    expect(tokenTracePathFor(vaultPath, "orphan")).toBe(
      join(vaultPath, "workflow-state", "orphan-tokens.jsonl"),
    );
    expect(tokenTracePathFor(vaultPath, "run-7")).toBe(
      join(vaultPath, "workflow-state", "runs", "run-7.tokens.jsonl"),
    );
  });
});

describe("readTokenTrace — JSONL parsing", () => {
  let vaultPath: string;
  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "token-store-read-"));
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
  });
  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function tracePath(runId: string): string {
    return join(vaultPath, "workflow-state", "runs", `${runId}.tokens.jsonl`);
  }

  it("skips malformed and blank lines (project idiom)", () => {
    const path = tracePath("mixed");
    writeFileSync(
      path,
      `broken line\n${JSON.stringify(record())}\n\nanother broken\n${JSON.stringify(record({ tokens: 7 }))}\n`,
      "utf-8",
    );
    const records = readTokenTrace(path);
    expect(records.length).toBe(2);
    expect(records[1]!.tokens).toBe(7);
  });

  it("empty file yields zero records", () => {
    const path = tracePath("empty");
    writeFileSync(path, "", "utf-8");
    expect(readTokenTrace(path)).toEqual([]);
  });

  it("propagates ENOENT for a missing file", () => {
    expect(() => readTokenTrace(tracePath("nope"))).toThrow();
  });
});

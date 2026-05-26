import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { aggregateRun, aggregateAll, compareRuns } from "../src/lib/token-stats.js";
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

describe("aggregateRun — totals and grouping", () => {
  it("sums totalTokens, totalChars, recordCount", () => {
    const stats = aggregateRun("run-1", [
      record({ tokens: 100, chars: 400 }),
      record({ tokens: 250, chars: 900 }),
    ]);
    expect(stats.totalTokens).toBe(350);
    expect(stats.totalChars).toBe(1300);
    expect(stats.recordCount).toBe(2);
    expect(stats.runId).toBe("run-1");
  });

  it("groups byStep descending by tokens with percent", () => {
    const stats = aggregateRun("run-1", [
      record({ step: "read", tokens: 100 }),
      record({ step: "code", tokens: 300 }),
      record({ step: "code", tokens: 100 }),
    ]);
    expect(stats.byStep.map((g) => g.name)).toEqual(["code", "read"]);
    expect(stats.byStep[0]).toEqual({ name: "code", tokens: 400, percent: 80 });
    expect(stats.byStep[1]).toEqual({ name: "read", tokens: 100, percent: 20 });
    expect(stats.stepCount).toBe(2);
  });

  it("groups bySource with callCount and avgTokens (rounded)", () => {
    const stats = aggregateRun("run-1", [
      record({ source: "memory_search", tokens: 100 }),
      record({ source: "memory_search", tokens: 101 }),
      record({ source: "vault_read", tokens: 500 }),
    ]);
    const search = stats.bySource.find((s) => s.name === "memory_search")!;
    expect(search.tokens).toBe(201);
    expect(search.callCount).toBe(2);
    expect(search.avgTokens).toBe(101);
    const vault = stats.bySource.find((s) => s.name === "vault_read")!;
    expect(vault.avgTokens).toBe(500);
  });

  it("groups byVaultFile from vault_read records with reads count", () => {
    const stats = aggregateRun("run-1", [
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 100 }),
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 200 }),
      record({ source: "vault_read", payload: { path: "b.md" }, tokens: 50 }),
      record({ source: "memory_search", payload: { path: "ignored.md" }, tokens: 9 }),
    ]);
    const fileA = stats.byVaultFile.find((f) => f.path === "a.md")!;
    expect(fileA.tokens).toBe(300);
    expect(fileA.reads).toBe(2);
    const fileB = stats.byVaultFile.find((f) => f.path === "b.md")!;
    expect(fileB.reads).toBe(1);
    expect(stats.byVaultFile.some((f) => f.path === "ignored.md")).toBe(false);
  });
});

describe("aggregateRun — duration from timestamps", () => {
  it("derives durationMs from first/last record timestamps", () => {
    const stats = aggregateRun("run-1", [
      record({ timestamp: "2026-05-26T10:00:00.000Z" }),
      record({ timestamp: "2026-05-26T10:00:05.000Z" }),
      record({ timestamp: "2026-05-26T10:00:02.000Z" }),
    ]);
    expect(stats.startedAt).toBe("2026-05-26T10:00:00.000Z");
    expect(stats.endedAt).toBe("2026-05-26T10:00:05.000Z");
    expect(stats.durationMs).toBe(5000);
  });

  it("single record yields durationMs 0", () => {
    const stats = aggregateRun("run-1", [record()]);
    expect(stats.durationMs).toBe(0);
  });

  it("empty records yield durationMs null and null bounds", () => {
    const stats = aggregateRun("run-1", []);
    expect(stats.durationMs).toBeNull();
    expect(stats.startedAt).toBeNull();
    expect(stats.endedAt).toBeNull();
    expect(stats.recordCount).toBe(0);
    expect(stats.totalTokens).toBe(0);
  });
});

describe("aggregateRun — byEngramType GOTCHA", () => {
  it("yields [] when records lack payload.memoryType", () => {
    const stats = aggregateRun("run-1", [
      record({ source: "memory_search", payload: { query: "x" }, tokens: 100 }),
      record({ source: "memory_judge", payload: { memoryId: "m-1" }, tokens: 50 }),
    ]);
    expect(stats.byEngramType).toEqual([]);
  });

  it("groups by memoryType when present (defensive guard)", () => {
    const stats = aggregateRun("run-1", [
      record({ source: "memory_search", payload: { memoryType: "pattern" }, tokens: 100 }),
      record({ source: "memory_search", payload: { memoryType: "pattern" }, tokens: 100 }),
      record({ source: "memory_search", payload: { memoryType: "antipattern" }, tokens: 50 }),
    ]);
    const pattern = stats.byEngramType.find((g) => g.name === "pattern")!;
    expect(pattern.tokens).toBe(200);
    const antipattern = stats.byEngramType.find((g) => g.name === "antipattern")!;
    expect(antipattern.tokens).toBe(50);
  });

  it("ignores memoryType on non-memory_search sources", () => {
    const stats = aggregateRun("run-1", [
      record({ source: "memory_judge", payload: { memoryType: "pattern" }, tokens: 100 }),
    ]);
    expect(stats.byEngramType).toEqual([]);
  });
});

describe("aggregateAll — pooling", () => {
  let vaultPath: string;
  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "token-stats-all-"));
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
  });
  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function writeTrace(runId: string, records: TokenTraceRecord[]): void {
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(
      join(vaultPath, "workflow-state", "runs", `${runId}.tokens.jsonl`),
      content,
      "utf-8",
    );
  }

  it("pools all records across runs and nulls durationMs", () => {
    writeTrace("run-a", [
      record({ runId: "run-a", tokens: 100, timestamp: "2026-05-26T10:00:00.000Z" }),
    ]);
    writeTrace("run-b", [
      record({ runId: "run-b", tokens: 200, timestamp: "2026-05-26T11:00:00.000Z" }),
    ]);
    const stats = aggregateAll(vaultPath);
    expect(stats.runId).toBe("(all runs)");
    expect(stats.totalTokens).toBe(300);
    expect(stats.recordCount).toBe(2);
    expect(stats.durationMs).toBeNull();
    expect(stats.startedAt).toBe("2026-05-26T10:00:00.000Z");
    expect(stats.endedAt).toBe("2026-05-26T11:00:00.000Z");
  });
});

describe("detectWarnings — heuristic thresholds and boundaries", () => {
  it("split: 5000 tokens + 3 reads does NOT fire; 5001 + 4 fires", () => {
    const below = aggregateRun("run-1", [
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 5000 }),
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 0 }),
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 0 }),
    ]);
    expect(below.warnings.some((w) => w.kind === "split")).toBe(false);

    const above = aggregateRun("run-1", [
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 5001 }),
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 0 }),
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 0 }),
      record({ source: "vault_read", payload: { path: "a.md" }, tokens: 0 }),
    ]);
    expect(above.warnings.some((w) => w.kind === "split")).toBe(true);
  });

  it("dominant_source: 40% does NOT fire; 41% fires", () => {
    // Top source held at the boundary; the remainder is split so no other
    // source crosses the threshold. Total = 100 → percent reads directly.
    const below = aggregateRun("run-1", [
      record({ source: "vault_read", tokens: 40 }),
      record({ source: "memory_search", tokens: 35 }),
      record({ source: "memory_judge", tokens: 25 }),
    ]);
    expect(below.warnings.some((w) => w.kind === "dominant_source")).toBe(false);

    const above = aggregateRun("run-1", [
      record({ source: "vault_read", tokens: 41 }),
      record({ source: "memory_search", tokens: 34 }),
      record({ source: "memory_judge", tokens: 25 }),
    ]);
    expect(above.warnings.some((w) => w.kind === "dominant_source")).toBe(true);
  });

  it("total_budget: 500000 does NOT fire; 500001 fires", () => {
    const below = aggregateRun("run-1", [record({ source: "vault_read", tokens: 500000 })]);
    expect(below.warnings.some((w) => w.kind === "total_budget")).toBe(false);
    const above = aggregateRun("run-1", [record({ source: "vault_read", tokens: 500001 })]);
    expect(above.warnings.some((w) => w.kind === "total_budget")).toBe(true);
  });

  it("engram_cache: memoryId repeated 5 times does NOT fire; 6 fires", () => {
    const five = Array.from({ length: 5 }, () =>
      record({ source: "memory_judge", payload: { memoryId: "m-1" } }),
    );
    expect(aggregateRun("run-1", five).warnings.some((w) => w.kind === "engram_cache")).toBe(false);

    const six = Array.from({ length: 6 }, () =>
      record({ source: "memory_judge", payload: { memoryId: "m-1" } }),
    );
    expect(aggregateRun("run-1", six).warnings.some((w) => w.kind === "engram_cache")).toBe(true);
  });
});

describe("compareRuns — deltas, arrows, flagged", () => {
  it("computes per-step delta, percent, and arrow", () => {
    const stats = compareRuns(
      "run-a",
      [record({ step: "code", tokens: 100 })],
      "run-b",
      [record({ step: "code", tokens: 150 })],
    );
    expect(stats.totalA).toBe(100);
    expect(stats.totalB).toBe(150);
    const code = stats.steps.find((s) => s.step === "code")!;
    expect(code.deltaTokens).toBe(50);
    expect(code.deltaPercent).toBe(50);
    expect(code.arrow).toBe("↑");
    expect(code.flagged).toBe(true);
  });

  it("flags at >10%: 10% NOT flagged, 11% flagged", () => {
    const ten = compareRuns(
      "a",
      [record({ step: "code", tokens: 100 })],
      "b",
      [record({ step: "code", tokens: 110 })],
    );
    expect(ten.steps[0]!.deltaPercent).toBe(10);
    expect(ten.steps[0]!.flagged).toBe(false);

    const eleven = compareRuns(
      "a",
      [record({ step: "code", tokens: 100 })],
      "b",
      [record({ step: "code", tokens: 111 })],
    );
    expect(eleven.steps[0]!.deltaPercent).toBe(11);
    expect(eleven.steps[0]!.flagged).toBe(true);
  });

  it("decrease yields ↓ arrow", () => {
    const stats = compareRuns(
      "a",
      [record({ step: "code", tokens: 200 })],
      "b",
      [record({ step: "code", tokens: 100 })],
    );
    expect(stats.steps[0]!.arrow).toBe("↓");
  });

  it("equal yields → arrow and not flagged", () => {
    const stats = compareRuns(
      "a",
      [record({ step: "code", tokens: 100 })],
      "b",
      [record({ step: "code", tokens: 100 })],
    );
    expect(stats.steps[0]!.arrow).toBe("→");
    expect(stats.steps[0]!.deltaPercent).toBe(0);
    expect(stats.steps[0]!.flagged).toBe(false);
  });

  it("new step in B (A had none) → deltaPercent null, flagged true", () => {
    const stats = compareRuns(
      "a",
      [record({ step: "read", tokens: 100 })],
      "b",
      [record({ step: "read", tokens: 100 }), record({ step: "code", tokens: 50 })],
    );
    const code = stats.steps.find((s) => s.step === "code")!;
    expect(code.tokensA).toBe(0);
    expect(code.deltaPercent).toBeNull();
    expect(code.flagged).toBe(true);
    expect(code.arrow).toBe("↑");
  });

  it("unions and sorts step keys ascending", () => {
    const stats = compareRuns(
      "a",
      [record({ step: "review", tokens: 10 }), record({ step: "code", tokens: 10 })],
      "b",
      [record({ step: "read", tokens: 10 })],
    );
    expect(stats.steps.map((s) => s.step)).toEqual(["code", "read", "review"]);
  });
});

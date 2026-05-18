// Unit tests for the pure engram chart transforms — the four `*Chart`
// builders (happy + edge) and the two derived scalars. The scalar tests
// assert the DERIVATION (sum / count field), not a passthrough.

import { describe, expect, it } from "vitest";
import {
  byMethodChart,
  byMemoryTypeChart,
  perStepHitRateChart,
  byStepChart,
  totalMemories,
  pendingJudgments,
} from "@/components/engram/engramChartData";
import type { EngramStatsResponse } from "@/lib/api";

/** Build an `EngramStatsResponse` with the given fields overridden. */
function buildStats(overrides: Partial<EngramStatsResponse>): EngramStatsResponse {
  return {
    scope: { runCount: 0, vaultPath: "/p", cutoffISO: null },
    byMethod: {},
    byMemoryType: {},
    byStep: {},
    recentRuns: [],
    warnings: [],
    live: { health: null, topMemories: [] },
    crossRunReuse: { total: 0, reused: 0, percent: 0 },
    perStepHitRate: {},
    missingStepComplete: { totalRuns: 0, affectedRuns: [], count: 0 },
    ...overrides,
  };
}

/** Build a `byStep` map of N distinct steps, each with a unique total. */
function buildSteps(count: number): EngramStatsResponse["byStep"] {
  const steps: EngramStatsResponse["byStep"] = {};
  for (let index = 0; index < count; index += 1) {
    steps[`step-${index}`] = { search: index + 1, store: 0, judge: 0 };
  }
  return steps;
}

/** Build a `perStepHitRate` map of N steps, each with a unique percent. */
function buildHitRates(count: number): EngramStatsResponse["perStepHitRate"] {
  const rates: EngramStatsResponse["perStepHitRate"] = {};
  for (let index = 0; index < count; index += 1) {
    rates[`step-${index}`] = { searches: 10, nonEmpty: index, percent: index + 1 };
  }
  return rates;
}

describe("byMethodChart", () => {
  it("maps each method to its call count", () => {
    const stats = buildStats({
      byMethod: {
        memory_search: { count: 7, errors: 0, avgDurationMs: 12 },
        memory_store: { count: 3, errors: 1, avgDurationMs: 9 },
      },
    });
    expect(byMethodChart(stats)).toEqual([
      { label: "memory_search", value: 7 },
      { label: "memory_store", value: 3 },
    ]);
  });

  it("returns an empty array when no methods were recorded", () => {
    expect(byMethodChart(buildStats({}))).toEqual([]);
  });
});

describe("byMemoryTypeChart", () => {
  it("maps each memory type to its count", () => {
    const stats = buildStats({ byMemoryType: { pattern: 4, antipattern: 1 } });
    expect(byMemoryTypeChart(stats)).toEqual([
      { label: "pattern", value: 4 },
      { label: "antipattern", value: 1 },
    ]);
  });
});

describe("perStepHitRateChart", () => {
  it("returns an empty array for an empty perStepHitRate", () => {
    expect(perStepHitRateChart(buildStats({ perStepHitRate: {} }))).toEqual([]);
  });

  it("truncates to the ten highest rates when more than ten steps exist", () => {
    const chart = perStepHitRateChart(buildStats({ perStepHitRate: buildHitRates(15) }));
    expect(chart).toHaveLength(10);
    expect(chart[0]?.value).toBe(15);
    expect(chart[9]?.value).toBe(6);
  });
});

describe("byStepChart", () => {
  it("sums search, store, and judge per step", () => {
    const stats = buildStats({
      byStep: { code: { search: 2, store: 3, judge: 1 } },
    });
    expect(byStepChart(stats)).toEqual([{ label: "code", value: 6 }]);
  });

  it("truncates to the ten busiest steps when more than ten exist", () => {
    const chart = byStepChart(buildStats({ byStep: buildSteps(13) }));
    expect(chart).toHaveLength(10);
    expect(chart[0]?.value).toBe(13);
  });

  it("keeps the ten highest entries and drops the lowest", () => {
    const chart = byStepChart(buildStats({ byStep: buildSteps(13) }));
    // `buildSteps(13)` gives steps with totals 1..13; the ten kept are 13..4.
    expect(chart[9]?.value).toBe(4);
    const labels = chart.map((datum) => datum.label);
    expect(labels).not.toContain("step-0");
    expect(labels).not.toContain("step-1");
    expect(labels).not.toContain("step-2");
  });
});

describe("totalMemories", () => {
  it("derives the sum of every byMemoryType count", () => {
    const stats = buildStats({ byMemoryType: { pattern: 4, antipattern: 1, context: 5 } });
    expect(totalMemories(stats)).toBe(10);
  });

  it("is zero when no memories were stored", () => {
    expect(totalMemories(buildStats({}))).toBe(0);
  });
});

describe("pendingJudgments", () => {
  it("derives from missingStepComplete.count", () => {
    const stats = buildStats({
      missingStepComplete: {
        totalRuns: 5,
        affectedRuns: [{ runId: "run-1", step: "code", searches: 3, judges: 0 }],
        count: 4,
      },
    });
    expect(pendingJudgments(stats)).toBe(4);
  });
});

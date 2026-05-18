// Pure transforms from the `EngramStatsResponse` payload to `BarChart` data
// (named `engramChartData` rather than `engramCharts` to avoid a
// case-insensitive filesystem collision with the `EngramCharts.tsx` component).
//
// No React, no hooks — every export is a deterministic function over the
// stats object. The four `*Chart` builders produce `BarDatum[]`; `byStep` and
// `perStepHitRate` are truncated to the ten largest entries so a long history
// cannot grow the chart without bound. The two scalar derivations
// (`totalMemories`, `pendingJudgments`) are computed from the payload — they
// are NOT passthrough fields.

import type { BarDatum } from "@/components/charts/BarChart";
import type { EngramStatsResponse } from "@/lib/api";

/** Largest number of bars any single chart renders. */
const TOP_N = 10;

/** Sort descending by value and keep the {@link TOP_N} largest entries. */
function topByValue(data: BarDatum[]): BarDatum[] {
  return [...data].sort((a, b) => b.value - a.value).slice(0, TOP_N);
}

/** Engram operation calls per JSON-RPC method. */
export function byMethodChart(stats: EngramStatsResponse): BarDatum[] {
  return Object.entries(stats.byMethod).map(([label, slot]) => ({
    label,
    value: slot.count,
  }));
}

/** Stored memories grouped by their `memory_type`. */
export function byMemoryTypeChart(stats: EngramStatsResponse): BarDatum[] {
  return Object.entries(stats.byMemoryType).map(([label, value]) => ({
    label,
    value,
  }));
}

/**
 * Per-step `memory_search` non-empty hit rate as a percentage. Truncated to
 * the ten steps with the highest rate. An empty `perStepHitRate` (a known
 * upstream-data limitation) yields `[]`, which `BarChart` renders as "No data".
 */
export function perStepHitRateChart(stats: EngramStatsResponse): BarDatum[] {
  return topByValue(
    Object.entries(stats.perStepHitRate).map(([label, slot]) => ({
      label,
      value: slot.percent,
    })),
  );
}

/** Total engram operations per workflow step, truncated to the ten busiest. */
export function byStepChart(stats: EngramStatsResponse): BarDatum[] {
  return topByValue(
    Object.entries(stats.byStep).map(([label, slot]) => ({
      label,
      value: slot.search + slot.store + slot.judge,
    })),
  );
}

/** Total stored memories — the sum of every `byMemoryType` count. */
export function totalMemories(stats: EngramStatsResponse): number {
  return Object.values(stats.byMemoryType).reduce((sum, count) => sum + count, 0);
}

/** Memory_search calls left without a follow-up `memory_judge` in the step. */
export function pendingJudgments(stats: EngramStatsResponse): number {
  return stats.missingStepComplete.count;
}

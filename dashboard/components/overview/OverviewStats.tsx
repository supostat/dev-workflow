"use client";

// Overview KPI strip — paused workflow runs and pending tasks.
//
// "Recent commits" from the task-056 spec is omitted: there is no `/api/git`
// endpoint to source a commit count from. The two counters shown both derive
// from data the web API already exposes.

import { KpiCard } from "@/components/layout/KpiCard";
import type { ActivitySummary } from "./buildActivity";

interface OverviewStatsProps {
  /** Headline counters produced by `buildActivity`. */
  summary: ActivitySummary;
}

/** Two-card KPI strip summarising workflow and task state. */
export function OverviewStats({ summary }: OverviewStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <KpiCard label="Paused runs" value={summary.pausedRuns} />
      <KpiCard label="Pending tasks" value={summary.pendingTasks} />
    </div>
  );
}

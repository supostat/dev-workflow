// KPI strip for the Engram page — four metric cards plus a daemon-health
// badge. `health` arrives as a prop SEPARATE from `stats`: the page polls
// `getEngramHealth` on its own 30s interval, while `stats` is fetched once on
// mount. Server component: presentational only, no hooks.

import { KpiCard } from "@/components/layout/KpiCard";
import { Badge } from "@/components/ui/badge";
import type { EngramStatsResponse, EngramHealthResponse } from "@/lib/api";
import { totalMemories, pendingJudgments } from "./engramChartData";

interface EngramCardsProps {
  stats: EngramStatsResponse;
  /** Result of `getEngramHealth` — daemon liveness, polled independently. */
  health: EngramHealthResponse;
}

/** KPI strip — runs analysed, stored memories, cross-run reuse, pending judges. */
export function EngramCards({ stats, health }: EngramCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard label="Runs analysed" value={stats.scope.runCount} />
      <KpiCard label="Stored memories" value={totalMemories(stats)} />
      <KpiCard label="Cross-run reuse" value={`${stats.crossRunReuse.percent}%`} />
      <PendingJudgmentsCard count={pendingJudgments(stats)} />
      <div className="col-span-2 md:col-span-4">
        <DaemonHealthBadge health={health} />
      </div>
    </div>
  );
}

/** Pending-judgments card — flags an unhealthy backlog with a destructive tone. */
function PendingJudgmentsCard({ count }: { count: number }) {
  return (
    <KpiCard
      label="Pending judgments"
      value={count}
      className={count > 0 ? "border-status-aborted" : undefined}
    />
  );
}

/** Daemon-health badge — green when reachable and healthy, red otherwise. */
function DaemonHealthBadge({ health }: { health: EngramHealthResponse }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Engram daemon
      </span>
      <Badge
        variant={health.healthy ? "default" : "destructive"}
        className={health.healthy ? "bg-status-done" : undefined}
      >
        {health.healthy ? "Healthy" : "Unavailable"}
      </Badge>
    </div>
  );
}

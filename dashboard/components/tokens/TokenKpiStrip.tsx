// KPI strip for the Tokens page — five metric cards summarising one run's
// totals. Server component: presentational only, no hooks.

import { KpiCard } from "@/components/layout/KpiCard";
import type { TokenRunStatsResponse } from "@/lib/api";

interface TokenKpiStripProps {
  stats: TokenRunStatsResponse;
}

/** Run totals — tokens, chars, records, duration, and distinct step count. */
export function TokenKpiStrip({ stats }: TokenKpiStripProps) {
  const duration = stats.durationMs === null ? "—" : `${stats.durationMs} ms`;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <KpiCard label="Total tokens" value={stats.totalTokens} />
      <KpiCard label="Total chars" value={stats.totalChars} />
      <KpiCard label="Records" value={stats.recordCount} />
      <KpiCard label="Duration" value={duration} />
      <KpiCard label="Steps" value={stats.stepCount} />
    </div>
  );
}

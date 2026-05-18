// Engram-page chart grid — four `Panel`s, each wrapping a `BarChart` built by
// one of the pure transforms in `engramCharts.ts`. Composition only: no hooks,
// no client state. An empty transform result renders `BarChart`'s "No data"
// fallback (notably `perStepHitRate`, which may be empty upstream).

import { Panel } from "@/components/layout/Panel";
import { BarChart } from "@/components/charts/BarChart";
import type { EngramStatsResponse } from "@/lib/api";
import {
  byMethodChart,
  byMemoryTypeChart,
  perStepHitRateChart,
  byStepChart,
} from "./engramChartData";

/** 2×2 grid of engram-activity bar charts. */
export function EngramCharts({ stats }: { stats: EngramStatsResponse }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Panel title="Calls by method">
        <BarChart data={byMethodChart(stats)} />
      </Panel>
      <Panel title="Memories by type">
        <BarChart data={byMemoryTypeChart(stats)} />
      </Panel>
      <Panel title="Hit rate by step">
        <BarChart data={perStepHitRateChart(stats)} />
      </Panel>
      <Panel title="Activity by step">
        <BarChart data={byStepChart(stats)} />
      </Panel>
    </div>
  );
}

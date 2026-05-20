"use client";

// Live-trace panel for the Engram page — a run picker over `stats.recentRuns`
// plus the reusable `TraceTail` viewer. No run is selected on mount, so the
// `TraceTail` runId stays `null` and the viewer renders empty until the user
// picks a run. The trace subscription itself rides the shared `sseHub`
// connection — there is no per-panel EventSource and no project plumbing.

import { useState } from "react";
import { Panel } from "@/components/layout/Panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TraceTail } from "@/components/workflow/TraceTail";
import type { EngramStatsResponse } from "@/lib/api";

/** Live engram-trace panel with a run picker sourced from `recentRuns`. */
export function TraceTailPanel({ stats }: { stats: EngramStatsResponse }) {
  const [runId, setRunId] = useState<string | null>(null);
  const runs = stats.recentRuns;

  return (
    <Panel
      title="Live trace"
      live
      actions={
        runs.length > 0 ? (
          <Select value={runId ?? undefined} onValueChange={setRunId}>
            <SelectTrigger size="sm" aria-label="Select run">
              <SelectValue placeholder="Select a run" />
            </SelectTrigger>
            <SelectContent>
              {runs.map((run) => (
                <SelectItem key={run.id} value={run.id}>
                  {run.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    >
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs to trace.</p>
      ) : (
        <TraceTail runId={runId} />
      )}
    </Panel>
  );
}

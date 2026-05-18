"use client";

// Live-trace panel for the Engram page — a run picker over `stats.recentRuns`
// plus the reusable `TraceTail` viewer. No run is selected on mount, so the
// trace URL stays `null` (the server 400s on a missing runId); picking a run
// resolves the URL to `/events/trace?runId=<encoded>` and `TraceTail` opens
// the SSE subscription.

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

/** Build the `trace` SSE endpoint for a run id, or `null` when none is picked. */
function traceUrl(runId: string | null): string | null {
  return runId === null ? null : `/events/trace?runId=${encodeURIComponent(runId)}`;
}

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
        <TraceTail url={traceUrl(runId)} />
      )}
    </Panel>
  );
}

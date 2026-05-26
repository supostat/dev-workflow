"use client";

// Tokens route (`/tokens`) — read-only token-usage observability page.
//
// A two-stage loader fronts the two REST endpoints. The first stage fetches
// the discovered run list (`getTokenRuns`) and derives the target run; the
// second fetches that run's breakdown (`getTokenStats`). Selecting a run skips
// the first stage and re-fetches stats only.
//
// Project-switch race: one generation ticket is captured before the awaits and
// re-checked after EACH await; a response whose ticket no longer matches the
// current generation is discarded (it belongs to a project switched away from).

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProjectNotice } from "@/components/layout/ProjectNotice";
import { Panel } from "@/components/layout/Panel";
import { useApi, useActiveProject } from "@/lib/project-context";
import type { BoundApi } from "@/lib/project-context";
import type { TokenRunStatsResponse, TokenRunSummary } from "@/lib/api";
import { RunPicker } from "@/components/tokens/RunPicker";
import { TokenKpiStrip } from "@/components/tokens/TokenKpiStrip";
import { BreakdownTable } from "@/components/tokens/BreakdownTable";
import { WarningsList } from "@/components/tokens/WarningsList";

export default function TokensPage() {
  const api = useApi();
  const { activeProject } = useActiveProject();
  const boundApi = api.ready ? api.api : null;

  const [runs, setRuns] = useState<TokenRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [stats, setStats] = useState<TokenRunStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const reload = useTokenLoader(boundApi, activeProject, generation, {
    setRuns,
    setSelectedRunId,
    setStats,
    setError,
  });

  useEffect(() => {
    generation.current += 1;
    if (boundApi !== null) void reload(undefined);
  }, [boundApi, activeProject, reload]);

  if (!api.ready) {
    return <ProjectNotice reason={api.reason} message={api.reason === "error" ? api.message : undefined} />;
  }
  if (error !== null) {
    return (
      <div className="mx-auto max-w-6xl rounded-md border border-border bg-card p-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button className="mt-2" size="sm" variant="outline" onClick={() => void reload(selectedRunId ?? undefined)}>
          Retry
        </Button>
      </div>
    );
  }
  if (stats === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading token usage…</p>;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <Panel
        title="Token usage"
        actions={
          <>
            <RunPicker runs={runs} selectedRunId={selectedRunId} onSelect={(runId) => void reload(runId)} />
            <Button size="sm" variant="outline" onClick={() => void reload(undefined)}>
              Refresh
            </Button>
          </>
        }
      >
        <TokenKpiStrip stats={stats} />
      </Panel>
      <BreakdownTable
        title="By step"
        columns={["Step", "Tokens", "%"]}
        rows={stats.byStep.map((group) => [group.name, group.tokens, group.percent])}
      />
      <BreakdownTable
        title="By source"
        columns={["Source", "Tokens", "Calls", "Avg"]}
        rows={stats.bySource.map((group) => [group.name, group.tokens, group.callCount, group.avgTokens])}
      />
      <BreakdownTable
        title="By vault file"
        columns={["Path", "Tokens", "Reads"]}
        rows={stats.byVaultFile.map((group) => [group.path, group.tokens, group.reads])}
      />
      <BreakdownTable
        title="By engram type"
        columns={["Type", "Tokens", "%"]}
        rows={stats.byEngramType.map((group) => [group.name, group.tokens, group.percent])}
      />
      <WarningsList warnings={stats.warnings} />
    </div>
  );
}

interface TokenLoaderSetters {
  setRuns: (runs: TokenRunSummary[]) => void;
  setSelectedRunId: (runId: string | null) => void;
  setStats: (stats: TokenRunStatsResponse) => void;
  setError: (error: string | null) => void;
}

/**
 * Build the two-stage, generation-guarded token loader. `runId === undefined`
 * runs the full two stages (run list → stats); a defined `runId` skips the run
 * list and fetches stats only.
 */
function useTokenLoader(
  api: BoundApi | null,
  project: string | null,
  generation: { current: number },
  { setRuns, setSelectedRunId, setStats, setError }: TokenLoaderSetters,
): (runId?: string) => Promise<void> {
  return useCallback(
    async (runId?: string): Promise<void> => {
      if (api === null) return;
      const ticket = generation.current;
      try {
        let targetRunId = runId;
        if (runId === undefined) {
          const { runs } = await api.getTokenRuns();
          if (ticket !== generation.current) return;
          setRuns(runs);
          targetRunId = runs[0]?.runId;
          setSelectedRunId(targetRunId ?? null);
        }
        const stats = await api.getTokenStats(targetRunId);
        if (ticket !== generation.current) return;
        setSelectedRunId(stats.runId);
        setStats(stats);
        setError(null);
      } catch (reason: unknown) {
        if (ticket !== generation.current) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        toast.error(`Failed to load token usage: ${message}`);
      }
    },
    [api, project, generation, setRuns, setSelectedRunId, setStats, setError],
  );
}

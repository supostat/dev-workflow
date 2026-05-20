"use client";

// Workflow route (`/workflow`) — the read-only runs list.
//
// Live updates arrive over the multiplexed `runs` SSE topic: every run-state
// change re-fetches the list. A generation counter keyed on the active
// project discards a response that belongs to a project switched away from
// mid-fetch. The list is read-only — run mutations happen through the CLI,
// surfaced by the hint banner.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/layout/Panel";
import { ProjectNotice } from "@/components/layout/ProjectNotice";
import { Button } from "@/components/ui/button";
import { useApi, useActiveProject } from "@/lib/project-context";
import type { BoundApi } from "@/lib/project-context";
import type { ApiWorkflowRun } from "@/lib/types";
import { useSseTopic } from "@/lib/sse";
import { WorkflowFilters } from "@/components/workflow/WorkflowFilters";
import { RunsTable } from "@/components/workflow/RunsTable";
import {
  EMPTY_RUN_FILTER,
  applyRunFilter,
  collectWorkflows,
  type RunFilterState,
} from "@/components/workflow/runFilter";

export default function WorkflowPage() {
  const api = useApi();
  const { activeProject } = useActiveProject();
  const boundApi = api.ready ? api.api : null;

  const [runs, setRuns] = useState<ApiWorkflowRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilterState>(EMPTY_RUN_FILTER);

  const generation = useRef(0);
  const reload = useRunLoader(boundApi, activeProject, generation, setRuns, setError);

  useEffect(() => {
    generation.current += 1;
    if (boundApi !== null) void reload();
  }, [boundApi, activeProject, reload]);

  useSseTopic("runs", () => {
    void reload();
  });

  if (!api.ready) {
    return <ProjectNotice reason={api.reason} message={api.reason === "error" ? api.message : undefined} />;
  }

  const visible = applyRunFilter(runs, filter);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <CliHintBanner />
      <Panel title="Workflow runs" live>
        <div className="flex flex-col gap-3">
          <WorkflowFilters
            filter={filter}
            workflows={collectWorkflows(runs)}
            onChange={setFilter}
          />
          {error !== null ? (
            <div>
              <p className="text-sm text-destructive">{error}</p>
              <Button className="mt-2" size="sm" variant="outline" onClick={() => void reload()}>
                Retry
              </Button>
            </div>
          ) : (
            <RunsTable runs={visible} />
          )}
        </div>
      </Panel>
    </div>
  );
}

/** Build the generation-guarded run-list loader. */
function useRunLoader(
  api: BoundApi | null,
  project: string | null,
  generation: { current: number },
  setRuns: (runs: ApiWorkflowRun[]) => void,
  setError: (error: string | null) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    if (api === null) return;
    const ticket = generation.current;
    try {
      const response = await api.getWorkflowRuns();
      if (ticket !== generation.current) return;
      setRuns(response.runs);
      setError(null);
    } catch (reason: unknown) {
      if (ticket !== generation.current) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      toast.error(`Failed to load runs: ${message}`);
    }
  }, [api, project, generation, setRuns, setError]);
}

/** Banner explaining that runs are started and controlled from the CLI. */
function CliHintBanner() {
  return (
    <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
      Workflow runs are read-only here. Start and drive runs from the CLI —{" "}
      <code className="font-mono">dev-workflow workflow run</code>.
    </div>
  );
}

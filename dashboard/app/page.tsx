"use client";

// Overview route (`/`) — the dashboard entry point.
//
// Composes the project header, the KPI strip, and the live activity feed from
// one `buildActivity` fetch pass. The page renders three explicit states:
// `!ready` while the active project resolves, a fetch-error panel with a retry
// action, and the loaded view. Live updates: a `/events/vault` or
// `/events/runs` message re-runs `buildActivity` (which re-reads tasks too).

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/layout/Panel";
import { ProjectNotice } from "@/components/layout/ProjectNotice";
import { Button } from "@/components/ui/button";
import { useApi, useActiveProject } from "@/lib/project-context";
import type { BoundApi } from "@/lib/project-context";
import { eventSourceUrl, useEventSource } from "@/lib/sse";
import { OverviewHeader } from "@/components/overview/OverviewHeader";
import { OverviewStats } from "@/components/overview/OverviewStats";
import { ActivityFeed } from "@/components/overview/ActivityFeed";
import { buildActivity, type OverviewData } from "@/components/overview/buildActivity";

export default function OverviewPage() {
  const api = useApi();
  const { activeProject } = useActiveProject();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const boundApi = api.ready ? api.api : null;
  const load = useOverviewLoader(boundApi, setData, setError);

  useEffect(() => {
    if (boundApi !== null) void load();
  }, [boundApi, load]);

  useEventSource(eventSourceUrl("vault", activeProject), "vault", () => void load());
  useEventSource(eventSourceUrl("runs", activeProject), "runs", () => void load());

  if (!api.ready) {
    return <ProjectNotice reason={api.reason} message={api.reason === "error" ? api.message : undefined} />;
  }
  if (error !== null) return <OverviewError message={error} onRetry={() => void load()} />;
  if (data === null) return <CenteredNotice message="Loading overview…" />;
  return <OverviewBody project={activeProject ?? ""} data={data} />;
}

/** Build the memoised `buildActivity` loader bound to the current project. */
function useOverviewLoader(
  api: BoundApi | null,
  setData: (data: OverviewData) => void,
  setError: (error: string | null) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    if (api === null) return;
    try {
      setData(await buildActivity(api));
      setError(null);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      toast.error(`Failed to load overview: ${message}`);
    }
  }, [api, setData, setError]);
}

/** The loaded Overview layout — header, KPI strip, activity feed. */
function OverviewBody({ project, data }: { project: string; data: OverviewData }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <OverviewHeader project={project} currentPhase={data.currentPhase} />
      <OverviewStats summary={data.summary} />
      <ActivityFeed feed={data.feed} />
    </div>
  );
}

/** Fetch-error panel with a retry action. */
function OverviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Panel title="Overview">
        <p className="text-sm text-destructive">{message}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </Panel>
    </div>
  );
}

/** Centered single-line status message for the loading states. */
function CenteredNotice({ message }: { message: string }) {
  return (
    <p className="mx-auto max-w-4xl py-12 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}

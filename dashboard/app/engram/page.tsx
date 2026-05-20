"use client";

// Engram route (`/engram`) — the engram-memory observability page.
//
// One mount fetch loads `getEngramStats` (KPI cards, four charts, recent
// memories, the run picker). Daemon health is polled SEPARATELY on a 30s
// `setInterval` calling `getEngramHealth` only — it never re-fetches the full
// stats payload. The interval is cleared on unmount.
//
// Project-switch race: each stats fetch is tagged with a generation counter
// keyed on the active project; a response whose generation no longer matches
// the current one is discarded (it belongs to a project switched away from).

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProjectNotice } from "@/components/layout/ProjectNotice";
import { useApi, useActiveProject } from "@/lib/project-context";
import type { BoundApi } from "@/lib/project-context";
import type { EngramStatsResponse, EngramHealthResponse } from "@/lib/api";
import { EngramCards } from "@/components/engram/EngramCards";
import { EngramCharts } from "@/components/engram/EngramCharts";
import { RecentMemories } from "@/components/engram/RecentMemories";
import { TraceTailPanel } from "@/components/engram/TraceTailPanel";

/** Daemon-health poll interval — matches the SSE heartbeat cadence. */
const HEALTH_REFRESH_MS = 30_000;

export default function EngramPage() {
  const api = useApi();
  const { activeProject } = useActiveProject();
  const boundApi = api.ready ? api.api : null;

  const [stats, setStats] = useState<EngramStatsResponse | null>(null);
  const [health, setHealth] = useState<EngramHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const reload = useStatsLoader(boundApi, activeProject, generation, setStats, setError);
  const refreshHealth = useHealthRefresher(boundApi, setHealth);

  useEffect(() => {
    generation.current += 1;
    if (boundApi !== null) {
      void reload();
      void refreshHealth();
    }
  }, [boundApi, activeProject, reload, refreshHealth]);

  useEffect(() => {
    if (boundApi === null) return;
    const timer = setInterval(() => void refreshHealth(), HEALTH_REFRESH_MS);
    return () => clearInterval(timer);
  }, [boundApi, refreshHealth]);

  if (!api.ready) {
    return <ProjectNotice reason={api.reason} message={api.reason === "error" ? api.message : undefined} />;
  }
  if (error !== null) {
    return (
      <div className="mx-auto max-w-6xl rounded-md border border-border bg-card p-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button className="mt-2" size="sm" variant="outline" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    );
  }
  if (stats === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading engram stats…</p>;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <EngramCards stats={stats} health={health ?? { healthy: false, status: null }} />
      <EngramCharts stats={stats} />
      <RecentMemories stats={stats} />
      <TraceTailPanel stats={stats} />
    </div>
  );
}

/** Build the generation-guarded engram-stats loader. */
function useStatsLoader(
  api: BoundApi | null,
  project: string | null,
  generation: { current: number },
  setStats: (stats: EngramStatsResponse) => void,
  setError: (error: string | null) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    if (api === null) return;
    const ticket = generation.current;
    try {
      const response = await api.getEngramStats();
      if (ticket !== generation.current) return;
      setStats(response);
      setError(null);
    } catch (reason: unknown) {
      if (ticket !== generation.current) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      toast.error(`Failed to load engram stats: ${message}`);
    }
  }, [api, project, generation, setStats, setError]);
}

/**
 * Build the daemon-health refresher. A failed probe is treated as an
 * unavailable daemon (`{ healthy: false }`) rather than a page error — health
 * is a secondary signal and must not blank the loaded stats view.
 */
function useHealthRefresher(
  api: BoundApi | null,
  setHealth: (health: EngramHealthResponse) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    if (api === null) return;
    try {
      setHealth(await api.getEngramHealth());
    } catch {
      setHealth({ healthy: false, status: null });
    }
  }, [api, setHealth]);
}

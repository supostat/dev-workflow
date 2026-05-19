"use client";

// Settings route (`/settings`) — communication.yaml editor, project registry,
// and the migration-lock viewer.
//
// One mount fetch loads `getSettings` (the communication editor + lock viewer
// data). The project registry is project-independent (`getProjects`) and loads
// itself inside `ProjectRegistryEditor`.
//
// Project-switch race: the settings fetch is tagged with a generation counter
// keyed on the active project; a response whose generation no longer matches
// the current one is discarded (it belongs to a project switched away from).

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProjectNotice } from "@/components/layout/ProjectNotice";
import { useApi, useActiveProject } from "@/lib/project-context";
import type { BoundApi } from "@/lib/project-context";
import type { SettingsResponse } from "@/lib/api";
import { CommunicationEditor } from "@/components/settings/CommunicationEditor";
import { ProjectRegistryEditor } from "@/components/settings/ProjectRegistryEditor";
import { LockViewer } from "@/components/settings/LockViewer";

export default function SettingsPage() {
  const api = useApi();
  const { activeProject } = useActiveProject();
  const boundApi = api.ready ? api.api : null;

  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const reload = useSettingsLoader(boundApi, activeProject, generation, setSettings, setError);

  useEffect(() => {
    generation.current += 1;
    if (boundApi !== null) void reload();
  }, [boundApi, activeProject, reload]);

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
  if (settings === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading settings…</p>;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <CommunicationEditor settings={settings} api={boundApi as BoundApi} />
      <ProjectRegistryEditor />
      <LockViewer settings={settings} />
    </div>
  );
}

/** Build the generation-guarded settings loader. */
function useSettingsLoader(
  api: BoundApi | null,
  project: string | null,
  generation: { current: number },
  setSettings: (settings: SettingsResponse) => void,
  setError: (error: string | null) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    if (api === null) return;
    const ticket = generation.current;
    try {
      const response = await api.getSettings();
      if (ticket !== generation.current) return;
      setSettings(response);
      setError(null);
    } catch (reason: unknown) {
      if (ticket !== generation.current) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      toast.error(`Failed to load settings: ${message}`);
    }
  }, [api, project, generation, setSettings, setError]);
}

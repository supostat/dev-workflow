"use client";

// Migration-lock viewer for the Settings page. `GET /api/settings` carries the
// parsed `.dev-workflow.lock` document (or null) plus a `lockFilePresent` flag.
// When a lock is present it is pretty-printed; otherwise an empty state shows.
// The lock shape is opaque to the dashboard — it is rendered, never introspected.

import { Panel } from "@/components/layout/Panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SettingsResponse } from "@/lib/api";

/** Read-only pretty-printed view of the project's migration lock. */
export function LockViewer({ settings }: { settings: SettingsResponse }) {
  return (
    <Panel title="Migration lock">
      {settings.lockFilePresent ? (
        <ScrollArea className="h-64">
          <pre className="font-mono text-xs leading-relaxed text-foreground">
            {JSON.stringify(settings.lock, null, 2)}
          </pre>
        </ScrollArea>
      ) : (
        <p className="text-sm text-muted-foreground">No lock file present.</p>
      )}
    </Panel>
  );
}

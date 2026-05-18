"use client";

// Overview activity feed — the merged vault / task / run timeline produced by
// `buildActivity`, newest first. The panel carries the `live` badge because the
// parent page re-runs the fetch on every `/events/vault` and `/events/runs`
// message; task rows refresh whenever one of those re-fetches fires.

import { FileText, ListTodo, Workflow } from "lucide-react";
import type { ReactElement } from "react";
import { Panel } from "@/components/layout/Panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { ActivityEntry } from "./buildActivity";

interface ActivityFeedProps {
  /** The 10 most recent activity rows, already sorted newest-first. */
  feed: ActivityEntry[];
}

/** Live-updating timeline of the 10 most recent project events. */
export function ActivityFeed({ feed }: ActivityFeedProps) {
  return (
    <Panel title="Recent activity" live>
      {feed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent activity.</p>
      ) : (
        <ScrollArea className="h-72">
          <ul className="flex flex-col">
            {feed.map((entry, index) => (
              <ActivityRow key={entry.id} entry={entry} first={index === 0} />
            ))}
          </ul>
        </ScrollArea>
      )}
    </Panel>
  );
}

/** One feed line — kind icon, summary text, and a formatted timestamp. */
function ActivityRow({ entry, first }: { entry: ActivityEntry; first: boolean }) {
  return (
    <li>
      {first ? null : <Separator />}
      <div className="flex items-center gap-3 py-2">
        <span className="text-muted-foreground">{kindIcon(entry.kind)}</span>
        <span className="flex-1 truncate text-sm">{entry.title}</span>
        <time className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatTimestamp(entry.timestamp)}
        </time>
      </div>
    </li>
  );
}

/** The lucide icon for a feed row's source kind. */
function kindIcon(kind: ActivityEntry["kind"]): ReactElement {
  if (kind === "vault") return <FileText className="size-4" aria-label="vault" />;
  if (kind === "run") return <Workflow className="size-4" aria-label="run" />;
  return <ListTodo className="size-4" aria-label="task" />;
}

/** Render an ISO timestamp as a locale date-time, or the raw value on parse. */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

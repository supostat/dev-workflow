"use client";

// Overview header panel — the active project name plus its current phase.
//
// Git context (current branch, recent commits) the task-056 spec calls for is
// intentionally absent: the web API exposes no `/api/git` endpoint. The phase
// is recovered from gameplan frontmatter by `buildActivity`; an unavailable
// phase renders an explicit em dash rather than a blank.

import { Panel } from "@/components/layout/Panel";
import { Badge } from "@/components/ui/badge";

interface OverviewHeaderProps {
  /** The active project's registry name. */
  project: string;
  /** `current-phase` from gameplan frontmatter, or null when unavailable. */
  currentPhase: string | null;
}

/** Project identity panel for the top of the Overview page. */
export function OverviewHeader({ project, currentPhase }: OverviewHeaderProps) {
  return (
    <Panel title="Project">
      <div className="flex items-center justify-between gap-4">
        <p className="text-lg font-semibold tracking-tight">{project}</p>
        <Badge variant="secondary" className="font-mono">
          {currentPhase ?? "— no phase —"}
        </Badge>
      </div>
    </Panel>
  );
}

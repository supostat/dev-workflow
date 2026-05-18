// Colour-coded status badge for a workflow run. Maps each `WorkflowStatus`
// to its design-token background (`bg-status-*`, locked by the task-058
// web-dashboard design-system ADR — the tokens meet WCAG AA).

import { Badge } from "@/components/ui/badge";
import type { ApiWorkflowRun } from "@/lib/types";

/** The run status union — derived from the list contract, not re-declared. */
type WorkflowStatus = ApiWorkflowRun["status"];

/** Tailwind background class per run status. */
const STATUS_CLASS: Record<WorkflowStatus, string> = {
  running: "bg-status-running text-white",
  paused: "bg-status-paused text-white",
  completed: "bg-status-done text-white",
  aborted: "bg-status-aborted text-white",
  failed: "bg-status-failed text-white",
};

/** Status badge for one workflow run, coloured by the run's status. */
export function RunStatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <Badge className={`border-transparent ${STATUS_CLASS[status]}`}>{status}</Badge>
  );
}

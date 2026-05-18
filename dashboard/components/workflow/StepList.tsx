// Step list for the run-detail Steps tab. Renders the run's
// `Record<string, ApiStepState>` map as an ordered list — one row per step
// with its status, attempt count, duration, and any captured error.

import { Badge } from "@/components/ui/badge";
import type { ApiStepState } from "@/lib/api";

/** Badge variant per step status. */
const STATUS_VARIANT: Record<ApiStepState["status"], "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  skipped: "outline",
};

/** Ordered list of a run's steps. */
export function StepList({ steps }: { steps: Record<string, ApiStepState> }) {
  const entries = Object.entries(steps);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">This run has no recorded steps.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {entries.map(([name, step]) => (
        <StepRow key={name} name={name} step={step} />
      ))}
    </ol>
  );
}

/** One step entry — name, status badge, attempt/duration meta, error line. */
function StepRow({ name, step }: { name: string; step: ApiStepState }) {
  return (
    <li className="rounded-md border border-border bg-card p-2">
      <div className="flex items-center gap-2">
        <Badge variant={STATUS_VARIANT[step.status]}>{step.status}</Badge>
        <span className="font-mono text-sm">{name}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {formatMeta(step)}
        </span>
      </div>
      {step.error !== null ? (
        <p className="mt-1 text-xs text-status-failed">{step.error}</p>
      ) : null}
    </li>
  );
}

/** Compact attempt/duration meta string for a step. */
function formatMeta(step: ApiStepState): string {
  const parts = [`attempt ${step.attempt}`];
  if (step.durationMs !== null) parts.push(`${Math.round(step.durationMs)} ms`);
  return parts.join(" · ");
}

// KPI strip card — a label, a large value, and an optional signed delta.
// Server component: presentational only, no hooks.

import { cn } from "@/lib/utils";

interface KpiCardProps {
  /** Short metric name shown above the value. */
  label: string;
  /** The metric's current value. */
  value: string | number;
  /** Optional period-over-period delta; sign drives the color. */
  delta?: number;
  className?: string;
}

/** Single metric card for the dashboard KPI strip. */
export function KpiCard({ label, value, delta, className }: KpiCardProps) {
  return (
    <div className={cn("rounded-md border border-border bg-card p-3", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {delta !== undefined ? <DeltaBadge delta={delta} /> : null}
    </div>
  );
}

/** Signed delta line — green when positive, red when negative, muted at zero. */
function DeltaBadge({ delta }: { delta: number }) {
  const tone =
    delta > 0
      ? "text-status-done"
      : delta < 0
        ? "text-status-failed"
        : "text-muted-foreground";
  const sign = delta > 0 ? "+" : "";
  return <p className={cn("mt-1 text-xs tabular-nums", tone)}>{`${sign}${delta}`}</p>;
}

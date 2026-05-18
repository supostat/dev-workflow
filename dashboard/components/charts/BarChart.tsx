// CSS-only horizontal bar chart — no charting-library dependency. Each datum
// renders a label, a proportional bar, and its value. Server component.

import { cn } from "@/lib/utils";

/** One labelled bar in a {@link BarChart}. */
export interface BarDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarDatum[];
  className?: string;
}

/** Horizontal bars sized as a fraction of the largest value. */
export function BarChart({ data, className }: BarChartProps) {
  const max = data.reduce((peak, datum) => Math.max(peak, datum.value), 0);
  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No data</p>;
  }
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {data.map((datum) => (
        <li key={datum.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-muted-foreground">{datum.label}</span>
          <span className="h-3 flex-1 rounded-sm bg-muted">
            <span
              className="block h-full rounded-sm bg-status-running"
              style={{ width: `${max > 0 ? (datum.value / max) * 100 : 0}%` }}
            />
          </span>
          <span className="w-10 shrink-0 text-right tabular-nums">{datum.value}</span>
        </li>
      ))}
    </ul>
  );
}

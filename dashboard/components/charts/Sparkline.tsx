// Minimal inline trend line — a single SVG polyline, no charting-library
// dependency. Server component.

import { cn } from "@/lib/utils";

interface SparklineProps {
  /** Series values in chronological order. */
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 28;

/** Compact trend line scaled to fit the given box. */
export function Sparkline({
  values,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  className,
}: SparklineProps) {
  if (values.length < 2) {
    return <span className="text-xs text-muted-foreground">No trend</span>;
  }
  return (
    <svg
      className={cn("text-status-running", className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="trend"
    >
      <polyline
        points={toPoints(values, width, height)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Map the series to `x,y` polyline points, scaled into the box. */
function toPoints(values: number[], width: number, height: number): string {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const step = width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

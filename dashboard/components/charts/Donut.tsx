// CSS-only donut chart — a single ring built from a `conic-gradient`, no SVG
// path math and no charting-library dependency. Server component.

import { cn } from "@/lib/utils";

/** One coloured slice of a {@link Donut}. `color` is any CSS color value. */
export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  data: DonutSlice[];
  /** Outer diameter in pixels. */
  size?: number;
  className?: string;
}

const DEFAULT_SIZE = 96;
const HOLE_RATIO = 0.6;

/** Ring chart rendered via a `conic-gradient` over the slice proportions. */
export function Donut({ data, size = DEFAULT_SIZE, className }: DonutProps) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) {
    return <p className="text-xs text-muted-foreground">No data</p>;
  }
  return (
    <div
      className={cn("rounded-full", className)}
      style={{ width: size, height: size, background: conicGradient(data, total) }}
      role="img"
      aria-label={data.map((slice) => `${slice.label}: ${slice.value}`).join(", ")}
    >
      <span
        className="block rounded-full bg-card"
        style={{
          width: size * HOLE_RATIO,
          height: size * HOLE_RATIO,
          margin: (size * (1 - HOLE_RATIO)) / 2,
        }}
      />
    </div>
  );
}

/** Build the `conic-gradient(...)` value from cumulative slice percentages. */
function conicGradient(data: DonutSlice[], total: number): string {
  let cursor = 0;
  const stops = data.map((slice) => {
    const start = (cursor / total) * 100;
    cursor += slice.value;
    const end = (cursor / total) * 100;
    return `${slice.color} ${start}% ${end}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

// Engram telemetry strip for the run-detail Overview tab — five compact stat
// chips for an `ApiTelemetryCounters` (search / store / judge / vaultRecord /
// skipped). Renders nothing meaningful when telemetry is absent.

import type { ApiTelemetryCounters } from "@/lib/api";

/** Chip label / counter-key pairs, in display order. */
const CHIPS: ReadonlyArray<{ key: keyof ApiTelemetryCounters; label: string }> = [
  { key: "search", label: "Search" },
  { key: "store", label: "Store" },
  { key: "judge", label: "Judge" },
  { key: "vaultRecord", label: "Vault" },
  { key: "skipped", label: "Skipped" },
];

/** Five-chip engram telemetry strip. */
export function TelemetryCounters({ telemetry }: { telemetry: ApiTelemetryCounters | null }) {
  if (telemetry === null) {
    return <p className="text-sm text-muted-foreground">No engram telemetry for this run.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => (
        <div key={chip.key} className="rounded-md border border-border bg-card px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{chip.label}</p>
          <p className="text-lg font-semibold tabular-nums">{telemetry[chip.key]}</p>
        </div>
      ))}
    </div>
  );
}

"use client";

// Run selector for the Tokens page — a single-value Select over the discovered
// token-trace runs (newest first). Selecting a run reports its id through
// `onSelect`; the page then re-fetches stats for that run only.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TokenRunSummary } from "@/lib/api";

interface RunPickerProps {
  /** Discovered runs, newest first. */
  runs: TokenRunSummary[];
  /** The currently selected run id, or null before the first load settles. */
  selectedRunId: string | null;
  /** Receives the chosen run id. */
  onSelect: (runId: string) => void;
}

/** Run-id Select; shows "No runs" when the project has no token traces. */
export function RunPicker({ runs, selectedRunId, onSelect }: RunPickerProps) {
  if (runs.length === 0) {
    return <span className="text-xs text-muted-foreground">No runs</span>;
  }
  return (
    <Select value={selectedRunId ?? undefined} onValueChange={onSelect}>
      <SelectTrigger size="sm" className="w-56" aria-label="Select run">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {runs.map((run) => (
          <SelectItem key={run.runId} value={run.runId} className="font-mono">
            {run.runId}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

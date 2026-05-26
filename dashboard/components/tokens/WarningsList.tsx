// Advisory list for the Tokens page — the analyzer's per-run warnings in a
// titled Panel, with a "No warnings." empty state. Server component:
// presentational only, no hooks.

import { Panel } from "@/components/layout/Panel";
import type { TokenWarning } from "@/lib/api";

interface WarningsListProps {
  warnings: TokenWarning[];
}

/** Renders the run's analyzer advisories, or a clean-run notice when empty. */
export function WarningsList({ warnings }: WarningsListProps) {
  return (
    <Panel title="Warnings">
      {warnings.length === 0 ? (
        <p className="text-xs text-muted-foreground">No warnings.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {warnings.map((warning, index) => (
            <li key={index} className="text-xs text-status-aborted">
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

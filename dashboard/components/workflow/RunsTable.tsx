"use client";

// Read-only Workflow runs data table. Columns mirror the list endpoint
// (`GET /api/workflow/runs`): id / workflow / status / currentStep /
// startedAt / updatedAt. A row click navigates to the run-detail route — a
// real query-param page (`/workflow/run/?id=...`) because the static export
// cannot pre-render runtime ids as path segments.

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiWorkflowRun } from "@/lib/types";
import { RunStatusBadge } from "./RunStatusBadge";

const COLUMNS = ["ID", "Workflow", "Status", "Current step", "Started", "Updated"] as const;

interface RunsTableProps {
  /** Runs to render, already filtered by the page. */
  runs: ApiWorkflowRun[];
}

/** The full Workflow runs table — clickable rows into the detail route. */
export function RunsTable({ runs }: RunsTableProps) {
  const router = useRouter();
  if (runs.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No workflow runs.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COLUMNS.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            onOpen={() =>
              router.push(`/workflow/run/?id=${encodeURIComponent(run.id)}`)
            }
          />
        ))}
      </TableBody>
    </Table>
  );
}

/** One run row — the whole row opens the detail route. */
function RunRow({ run, onOpen }: { run: ApiWorkflowRun; onOpen: () => void }) {
  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell className="font-mono text-xs">{run.id}</TableCell>
      <TableCell>{run.workflow}</TableCell>
      <TableCell>
        <RunStatusBadge status={run.status} />
      </TableCell>
      <TableCell className="font-mono text-xs">{run.currentStep ?? "—"}</TableCell>
      <TableCell className="font-mono text-xs">{run.startedAt}</TableCell>
      <TableCell className="font-mono text-xs">{run.updatedAt}</TableCell>
    </TableRow>
  );
}

// Generic token-breakdown table — a titled Panel wrapping a small immutable
// table. The Tokens page renders one per dimension (by step / source / vault
// file / engram type). Server component: presentational only, no hooks.

import { Panel } from "@/components/layout/Panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface BreakdownTableProps {
  /** Panel header label. */
  title: string;
  /** Column headers, left to right. */
  columns: string[];
  /** Row values aligned to `columns`; the first column is rendered monospace. */
  rows: Array<Array<string | number>>;
}

/** A titled breakdown table with a "No data" empty state. */
export function BreakdownTable({ title, columns, rows }: BreakdownTableProps) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} className="text-xs">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <TableCell
                    key={columnIndex}
                    className={cn(
                      columnIndex === 0 ? "font-mono text-xs" : "text-xs tabular-nums",
                    )}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

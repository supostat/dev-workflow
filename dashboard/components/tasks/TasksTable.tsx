"use client";

// Sortable Tasks data table. Column headers toggle the sort column/direction;
// each row's status cell carries an inline DropdownMenu that PATCHes the task
// optimistically. A click anywhere else on the row opens the detail Sheet.

import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { ApiTask } from "@/lib/types";
import type { SortDirection, TaskSortColumn } from "./taskFilter";

const TASK_STATUSES = ["pending", "in-progress", "review", "done", "blocked"] as const;

const COLUMNS: ReadonlyArray<{ key: TaskSortColumn; label: string }> = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "branch", label: "Branch" },
  { key: "updated", label: "Updated" },
];

interface TasksTableProps {
  /** Tasks to render, already filtered and sorted by the page. */
  tasks: ApiTask[];
  /** Active sort column. */
  sortColumn: TaskSortColumn;
  /** Active sort direction. */
  sortDirection: SortDirection;
  /** Toggle the sort column / flip direction when the same column repeats. */
  onSort: (column: TaskSortColumn) => void;
  /** Open the detail Sheet for a task. */
  onSelect: (task: ApiTask) => void;
  /** Inline status change for one task. */
  onStatusChange: (task: ApiTask, status: string) => void;
}

/** The full Tasks table — header, sortable columns, inline status edit. */
export function TasksTable({
  tasks,
  sortColumn,
  sortDirection,
  onSort,
  onSelect,
  onStatusChange,
}: TasksTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COLUMNS.map((column) => (
            <TableHead key={column.key}>
              <button
                type="button"
                className="flex items-center gap-1 font-medium"
                onClick={() => onSort(column.key)}
              >
                {column.label}
                <SortArrow active={sortColumn === column.key} direction={sortDirection} />
              </button>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onSelect={onSelect}
            onStatusChange={onStatusChange}
          />
        ))}
      </TableBody>
    </Table>
  );
}

/** One table row — cells open the Sheet, the status cell edits inline. */
function TaskRow({
  task,
  onSelect,
  onStatusChange,
}: {
  task: ApiTask;
  onSelect: (task: ApiTask) => void;
  onStatusChange: (task: ApiTask, status: string) => void;
}) {
  return (
    <TableRow className="cursor-pointer">
      <TableCell className="font-mono text-xs" onClick={() => onSelect(task)}>
        {task.id}
      </TableCell>
      <TableCell onClick={() => onSelect(task)}>{task.title}</TableCell>
      <TableCell>
        <StatusEditor task={task} onStatusChange={onStatusChange} />
      </TableCell>
      <TableCell onClick={() => onSelect(task)}>
        <Badge variant="outline">{task.priority}</Badge>
      </TableCell>
      <TableCell className="font-mono text-xs" onClick={() => onSelect(task)}>
        {task.branch ?? "—"}
      </TableCell>
      <TableCell className="font-mono text-xs" onClick={() => onSelect(task)}>
        {task.updated}
      </TableCell>
    </TableRow>
  );
}

/** Inline status DropdownMenu for one row. */
function StatusEditor({
  task,
  onStatusChange,
}: {
  task: ApiTask;
  onStatusChange: (task: ApiTask, status: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Status for ${task.id}`}>
        <Badge variant="secondary">{task.status}</Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {TASK_STATUSES.map((status) => (
          <DropdownMenuItem key={status} onSelect={() => onStatusChange(task, status)}>
            {status}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sort indicator — an arrow on the active column, nothing otherwise. */
function SortArrow({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return null;
  return direction === "asc" ? (
    <ArrowUp className="size-3" />
  ) : (
    <ArrowDown className="size-3" />
  );
}

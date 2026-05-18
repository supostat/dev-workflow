"use client";

// Filter bar for the Tasks table — a status multi-select, a priority select,
// a branch select (options derived from the current task set), and a
// full-text search input. Each control reports its change through one
// `onChange` callback that produces the next immutable `TaskFilterState`.

import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskFilterState } from "./taskFilter";

const TASK_STATUSES = ["pending", "in-progress", "review", "done", "blocked"] as const;
const TASK_PRIORITIES = ["high", "medium", "low"] as const;
const ANY_VALUE = "__any__";

interface TaskFiltersProps {
  /** Current filter selection. */
  filter: TaskFilterState;
  /** Branch options derived from the loaded task set. */
  branches: string[];
  /** Receives the next filter state on any control change. */
  onChange: (next: TaskFilterState) => void;
}

/** Status / priority / branch / search controls for the Tasks table. */
export function TaskFilters({ filter, branches, onChange }: TaskFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusFilter filter={filter} onChange={onChange} />
      <PrioritySelect filter={filter} onChange={onChange} />
      <BranchSelect filter={filter} branches={branches} onChange={onChange} />
      <Input
        aria-label="Search tasks"
        placeholder="Search id or title…"
        className="h-8 w-56"
        value={filter.search}
        onChange={(event) => onChange({ ...filter, search: event.target.value })}
      />
    </div>
  );
}

/** Multi-select status filter — an empty set keeps every status. */
function StatusFilter({
  filter,
  onChange,
}: {
  filter: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
}) {
  const toggle = (status: string, checked: boolean): void => {
    const statuses = new Set(filter.statuses);
    if (checked) statuses.add(status);
    else statuses.delete(status);
    onChange({ ...filter, statuses });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          {filter.statuses.size === 0 ? "Status: any" : `Status (${filter.statuses.size})`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {TASK_STATUSES.map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={filter.statuses.has(status)}
            onCheckedChange={(checked) => toggle(status, checked === true)}
          >
            {status}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Single-value priority select; the "any" entry clears the filter. */
function PrioritySelect({
  filter,
  onChange,
}: {
  filter: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
}) {
  return (
    <Select
      value={filter.priority ?? ANY_VALUE}
      onValueChange={(value) =>
        onChange({ ...filter, priority: value === ANY_VALUE ? null : value })
      }
    >
      <SelectTrigger size="sm" className="w-36" aria-label="Priority filter">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_VALUE}>Priority: any</SelectItem>
        {TASK_PRIORITIES.map((priority) => (
          <SelectItem key={priority} value={priority}>
            {priority}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Single-value branch select populated from the loaded task set. */
function BranchSelect({
  filter,
  branches,
  onChange,
}: {
  filter: TaskFilterState;
  branches: string[];
  onChange: (next: TaskFilterState) => void;
}) {
  return (
    <Select
      value={filter.branch ?? ANY_VALUE}
      onValueChange={(value) =>
        onChange({ ...filter, branch: value === ANY_VALUE ? null : value })
      }
    >
      <SelectTrigger size="sm" className="w-44" aria-label="Branch filter">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_VALUE}>Branch: any</SelectItem>
        {branches.map((branch) => (
          <SelectItem key={branch} value={branch}>
            {branch}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

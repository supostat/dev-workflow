"use client";

// Filter bar for the Workflow runs table — a status multi-select and a
// workflow-name Select (options derived from the loaded run set). Each
// control reports its change through one `onChange` callback that produces
// the next immutable `RunFilterState`.

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RunFilterState } from "./runFilter";

const RUN_STATUSES = ["running", "paused", "completed", "aborted", "failed"] as const;
const ANY_VALUE = "__any__";

interface WorkflowFiltersProps {
  /** Current filter selection. */
  filter: RunFilterState;
  /** Workflow-name options derived from the loaded run set. */
  workflows: string[];
  /** Receives the next filter state on any control change. */
  onChange: (next: RunFilterState) => void;
}

/** Status / workflow-name controls for the runs table. */
export function WorkflowFilters({ filter, workflows, onChange }: WorkflowFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusFilter filter={filter} onChange={onChange} />
      <WorkflowSelect filter={filter} workflows={workflows} onChange={onChange} />
      <Input
        aria-label="Search runs"
        placeholder="Search id or workflow…"
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
  filter: RunFilterState;
  onChange: (next: RunFilterState) => void;
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
        {RUN_STATUSES.map((status) => (
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

/** Single-value workflow-name select; the "any" entry clears the filter. */
function WorkflowSelect({
  filter,
  workflows,
  onChange,
}: {
  filter: RunFilterState;
  workflows: string[];
  onChange: (next: RunFilterState) => void;
}) {
  return (
    <Select
      value={filter.workflow ?? ANY_VALUE}
      onValueChange={(value) =>
        onChange({ ...filter, workflow: value === ANY_VALUE ? null : value })
      }
    >
      <SelectTrigger size="sm" className="w-48" aria-label="Workflow filter">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY_VALUE}>Workflow: any</SelectItem>
        {workflows.map((workflow) => (
          <SelectItem key={workflow} value={workflow}>
            {workflow}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

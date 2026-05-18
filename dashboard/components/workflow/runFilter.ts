// Pure filter layer for the Workflow runs table — no React, unit-testable.
//
// `applyRunFilter` narrows a run list by status set, workflow name, and a
// case-insensitive id/workflow substring search. `collectWorkflows` derives
// the workflow-name filter options from whatever names the current run set
// actually carries.

import type { ApiWorkflowRun } from "@/lib/types";

/** Active filter selection for the Workflow runs table. */
export interface RunFilterState {
  /** Statuses to keep; an empty set keeps every status. */
  statuses: ReadonlySet<string>;
  /** Workflow name to keep, or null for any workflow. */
  workflow: string | null;
  /** Case-insensitive substring matched against id and workflow name. */
  search: string;
}

/** A filter state that keeps every run — the page's initial selection. */
export const EMPTY_RUN_FILTER: RunFilterState = {
  statuses: new Set<string>(),
  workflow: null,
  search: "",
};

/** Return the subset of `runs` matching every active filter dimension. */
export function applyRunFilter(runs: ApiWorkflowRun[], filter: RunFilterState): ApiWorkflowRun[] {
  const needle = filter.search.trim().toLowerCase();
  return runs.filter((run) => {
    if (filter.statuses.size > 0 && !filter.statuses.has(run.status)) return false;
    if (filter.workflow !== null && run.workflow !== filter.workflow) return false;
    if (needle.length > 0 && !matchesSearch(run, needle)) return false;
    return true;
  });
}

/** True when the lowercased needle is a substring of the run id or workflow. */
function matchesSearch(run: ApiWorkflowRun, needle: string): boolean {
  return (
    run.id.toLowerCase().includes(needle) ||
    run.workflow.toLowerCase().includes(needle)
  );
}

/**
 * Collect the distinct workflow names present in `runs`, sorted ascending.
 * Backs the workflow-name filter Select on the runs page.
 */
export function collectWorkflows(runs: ApiWorkflowRun[]): string[] {
  const workflows = new Set<string>();
  for (const run of runs) workflows.add(run.workflow);
  return [...workflows].sort((left, right) => left.localeCompare(right));
}

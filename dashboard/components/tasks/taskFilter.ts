// Pure filter/sort layer for the Tasks page — no React, unit-testable.
//
// `applyTaskFilter` narrows a task list by status set, priority, branch, and a
// case-insensitive id/title substring search. `sortTasks` orders by any table
// column with a stable direction. `collectBranches` derives the branch-filter
// option list from whatever branches the current task set actually carries.

import type { ApiTask } from "@/lib/types";

/** Columns the Tasks table can sort by. */
export type TaskSortColumn = "id" | "title" | "status" | "priority" | "branch" | "updated";

/** Sort direction for `sortTasks`. */
export type SortDirection = "asc" | "desc";

/** Active filter selection for the Tasks table. */
export interface TaskFilterState {
  /** Statuses to keep; an empty set keeps every status. */
  statuses: ReadonlySet<string>;
  /** Priority to keep, or null for any priority. */
  priority: string | null;
  /** Branch to keep, or null for any branch. */
  branch: string | null;
  /** Case-insensitive substring matched against id and title. */
  search: string;
}

/** A filter state that keeps every task — the page's initial selection. */
export const EMPTY_FILTER: TaskFilterState = {
  statuses: new Set<string>(),
  priority: null,
  branch: null,
  search: "",
};

/** Branch value used in the filter UI for tasks with no branch. */
export const NO_BRANCH = "(none)";

/** Return the subset of `tasks` matching every active filter dimension. */
export function applyTaskFilter(tasks: ApiTask[], filter: TaskFilterState): ApiTask[] {
  const needle = filter.search.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filter.statuses.size > 0 && !filter.statuses.has(task.status)) return false;
    if (filter.priority !== null && task.priority !== filter.priority) return false;
    if (filter.branch !== null && branchKey(task) !== filter.branch) return false;
    if (needle.length > 0 && !matchesSearch(task, needle)) return false;
    return true;
  });
}

/** True when the lowercased needle is a substring of the task id or title. */
function matchesSearch(task: ApiTask, needle: string): boolean {
  return (
    task.id.toLowerCase().includes(needle) ||
    task.title.toLowerCase().includes(needle)
  );
}

/** The branch value a task contributes to the filter — `NO_BRANCH` when null. */
function branchKey(task: ApiTask): string {
  return task.branch ?? NO_BRANCH;
}

/**
 * Return a sorted copy of `tasks`. The input array is never mutated. Equal
 * keys preserve input order — JavaScript's sort is stable since ES2019.
 */
export function sortTasks(
  tasks: ApiTask[],
  column: TaskSortColumn,
  direction: SortDirection,
): ApiTask[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...tasks].sort(
    (left, right) => factor * sortValue(left, column).localeCompare(sortValue(right, column)),
  );
}

/** The comparable string for a task in the given sort column. */
function sortValue(task: ApiTask, column: TaskSortColumn): string {
  switch (column) {
    case "id":
      return task.id;
    case "title":
      return task.title;
    case "status":
      return task.status;
    case "priority":
      return task.priority;
    case "branch":
      return task.branch ?? "";
    case "updated":
      return task.updated;
  }
}

/**
 * Collect the distinct branch values present in `tasks`, sorted ascending.
 * Tasks with no branch contribute the `NO_BRANCH` sentinel.
 */
export function collectBranches(tasks: ApiTask[]): string[] {
  const branches = new Set<string>();
  for (const task of tasks) branches.add(branchKey(task));
  return [...branches].sort((left, right) => left.localeCompare(right));
}

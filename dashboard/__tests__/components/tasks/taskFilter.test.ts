// Unit tests for the Tasks pure filter/sort layer.

import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  NO_BRANCH,
  applyTaskFilter,
  collectBranches,
  sortTasks,
  type TaskFilterState,
} from "@/components/tasks/taskFilter";
import type { ApiTask } from "@/lib/types";

/** A task with sensible defaults overridden per test. */
function task(overrides: Partial<ApiTask>): ApiTask {
  return {
    id: "task-001",
    title: "Sample",
    status: "pending",
    priority: "medium",
    branch: null,
    created: "2026-05-01T00:00:00.000Z",
    updated: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

const TASKS: ApiTask[] = [
  task({ id: "task-001", title: "Build dashboard", status: "done", priority: "high", branch: "feat/ui" }),
  task({ id: "task-002", title: "Fix parser", status: "pending", priority: "low", branch: "feat/ui" }),
  task({ id: "task-003", title: "Write docs", status: "review", priority: "medium", branch: null }),
];

/** A filter built from `EMPTY_FILTER` plus overrides. */
function filterWith(overrides: Partial<TaskFilterState>): TaskFilterState {
  return { ...EMPTY_FILTER, ...overrides };
}

describe("applyTaskFilter", () => {
  it("keeps every task when no dimension is set", () => {
    expect(applyTaskFilter(TASKS, EMPTY_FILTER)).toHaveLength(3);
  });

  it("filters by a multi-status set", () => {
    const result = applyTaskFilter(TASKS, filterWith({ statuses: new Set(["done", "review"]) }));
    expect(result.map((entry) => entry.id)).toEqual(["task-001", "task-003"]);
  });

  it("filters by priority", () => {
    const result = applyTaskFilter(TASKS, filterWith({ priority: "low" }));
    expect(result.map((entry) => entry.id)).toEqual(["task-002"]);
  });

  it("filters by branch including the no-branch sentinel", () => {
    const result = applyTaskFilter(TASKS, filterWith({ branch: NO_BRANCH }));
    expect(result.map((entry) => entry.id)).toEqual(["task-003"]);
  });

  it("matches the case-insensitive search against id and title", () => {
    expect(applyTaskFilter(TASKS, filterWith({ search: "PARSER" }))).toHaveLength(1);
    expect(applyTaskFilter(TASKS, filterWith({ search: "task-003" }))).toHaveLength(1);
  });
});

describe("sortTasks", () => {
  it("sorts by id ascending and descending without mutating the input", () => {
    const ascending = sortTasks(TASKS, "id", "asc");
    expect(ascending.map((entry) => entry.id)).toEqual(["task-001", "task-002", "task-003"]);
    expect(sortTasks(TASKS, "id", "desc").map((entry) => entry.id)).toEqual([
      "task-003",
      "task-002",
      "task-001",
    ]);
    expect(TASKS[0]?.id).toBe("task-001");
  });

  it("orders the full list by title in both directions", () => {
    expect(sortTasks(TASKS, "title", "asc").map((entry) => entry.id)).toEqual([
      "task-001",
      "task-002",
      "task-003",
    ]);
    expect(sortTasks(TASKS, "title", "desc").map((entry) => entry.id)).toEqual([
      "task-003",
      "task-002",
      "task-001",
    ]);
  });

  it("orders the full list by status in both directions", () => {
    expect(sortTasks(TASKS, "status", "asc").map((entry) => entry.status)).toEqual([
      "done",
      "pending",
      "review",
    ]);
    expect(sortTasks(TASKS, "status", "desc").map((entry) => entry.status)).toEqual([
      "review",
      "pending",
      "done",
    ]);
  });

  it("orders the full list by priority in both directions", () => {
    expect(sortTasks(TASKS, "priority", "asc").map((entry) => entry.priority)).toEqual([
      "high",
      "low",
      "medium",
    ]);
    expect(sortTasks(TASKS, "priority", "desc").map((entry) => entry.priority)).toEqual([
      "medium",
      "low",
      "high",
    ]);
  });

  it("orders the full list by branch with the null branch sorted first ascending", () => {
    expect(sortTasks(TASKS, "branch", "asc").map((entry) => entry.id)).toEqual([
      "task-003",
      "task-001",
      "task-002",
    ]);
    expect(sortTasks(TASKS, "branch", "desc").map((entry) => entry.id)).toEqual([
      "task-001",
      "task-002",
      "task-003",
    ]);
  });

  it("orders the full list by updated timestamp in both directions", () => {
    const dated: ApiTask[] = [
      task({ id: "task-a", updated: "2026-05-03T00:00:00.000Z" }),
      task({ id: "task-b", updated: "2026-05-01T00:00:00.000Z" }),
      task({ id: "task-c", updated: "2026-05-02T00:00:00.000Z" }),
    ];
    expect(sortTasks(dated, "updated", "asc").map((entry) => entry.id)).toEqual([
      "task-b",
      "task-c",
      "task-a",
    ]);
    expect(sortTasks(dated, "updated", "desc").map((entry) => entry.id)).toEqual([
      "task-a",
      "task-c",
      "task-b",
    ]);
  });
});

describe("collectBranches", () => {
  it("collects distinct branches with the no-branch sentinel, sorted", () => {
    expect(collectBranches(TASKS)).toEqual([NO_BRANCH, "feat/ui"]);
  });

  it("returns an empty list for no tasks", () => {
    expect(collectBranches([])).toEqual([]);
  });
});

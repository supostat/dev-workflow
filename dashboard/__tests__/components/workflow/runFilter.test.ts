// Unit tests for the pure Workflow runs filter layer.

import { describe, expect, it } from "vitest";
import {
  EMPTY_RUN_FILTER,
  applyRunFilter,
  collectWorkflows,
  type RunFilterState,
} from "@/components/workflow/runFilter";
import type { ApiWorkflowRun } from "@/lib/types";

const RUNS: ApiWorkflowRun[] = [
  {
    id: "run-aaaaaaaaaaaa",
    workflow: "dev",
    status: "running",
    currentStep: "code",
    startedAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T01:00:00.000Z",
  },
  {
    id: "run-bbbbbbbbbbbb",
    workflow: "review",
    status: "completed",
    currentStep: null,
    startedAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T01:00:00.000Z",
  },
  {
    id: "run-cccccccccccc",
    workflow: "dev",
    status: "failed",
    currentStep: "test",
    startedAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T01:00:00.000Z",
  },
];

describe("applyRunFilter", () => {
  it("keeps every run under the empty filter", () => {
    expect(applyRunFilter(RUNS, EMPTY_RUN_FILTER)).toHaveLength(3);
  });

  it("narrows by a non-empty status set", () => {
    const filter: RunFilterState = {
      ...EMPTY_RUN_FILTER,
      statuses: new Set(["running", "failed"]),
    };
    expect(applyRunFilter(RUNS, filter).map((run) => run.id)).toEqual([
      "run-aaaaaaaaaaaa",
      "run-cccccccccccc",
    ]);
  });

  it("narrows by workflow name", () => {
    const filter: RunFilterState = { ...EMPTY_RUN_FILTER, workflow: "review" };
    expect(applyRunFilter(RUNS, filter).map((run) => run.id)).toEqual([
      "run-bbbbbbbbbbbb",
    ]);
  });

  it("matches the search needle case-insensitively against id and workflow", () => {
    const byWorkflow: RunFilterState = { ...EMPTY_RUN_FILTER, search: "REVIEW" };
    expect(applyRunFilter(RUNS, byWorkflow)).toHaveLength(1);
    const byId: RunFilterState = { ...EMPTY_RUN_FILTER, search: "cccc" };
    expect(applyRunFilter(RUNS, byId).map((run) => run.id)).toEqual([
      "run-cccccccccccc",
    ]);
  });

  it("treats a whitespace-only search as empty", () => {
    const filter: RunFilterState = { ...EMPTY_RUN_FILTER, search: "   " };
    expect(applyRunFilter(RUNS, filter)).toHaveLength(3);
  });

  it("combines status and workflow filters conjunctively", () => {
    const filter: RunFilterState = {
      ...EMPTY_RUN_FILTER,
      statuses: new Set(["failed"]),
      workflow: "dev",
    };
    expect(applyRunFilter(RUNS, filter).map((run) => run.id)).toEqual([
      "run-cccccccccccc",
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    const filter: RunFilterState = { ...EMPTY_RUN_FILTER, search: "no-such-run" };
    expect(applyRunFilter(RUNS, filter)).toEqual([]);
  });
});

describe("collectWorkflows", () => {
  it("deduplicates and sorts the workflow names", () => {
    expect(collectWorkflows(RUNS)).toEqual(["dev", "review"]);
  });

  it("returns an empty array for no runs", () => {
    expect(collectWorkflows([])).toEqual([]);
  });
});

// Unit tests for the Overview pure data layer. `buildActivity` is exercised
// against a stub `BoundApi`; `parseCurrentPhase` is tested directly for the
// present / absent / malformed frontmatter cases.

import { describe, expect, it } from "vitest";
import {
  buildActivity,
  parseCurrentPhase,
} from "@/components/overview/buildActivity";
import type { BoundApi } from "@/lib/project-context";
import type { ApiTask, ApiWorkflowRun } from "@/lib/types";

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

/** A workflow run with sensible defaults overridden per test. */
function run(overrides: Partial<ApiWorkflowRun>): ApiWorkflowRun {
  return {
    id: "run-001",
    workflowName: "dev",
    taskId: null,
    taskDescription: "Sample run",
    phase: null,
    status: "running",
    currentStep: "code",
    startedAt: "2026-05-01T00:00:00.000Z",
    completedAt: null,
    steps: {},
    ...overrides,
  };
}

/** Build a stub `BoundApi` returning the supplied vault/task/run payloads. */
function stubApi(
  gameplan: string,
  tasks: ApiTask[],
  runs: ApiWorkflowRun[],
): BoundApi {
  return {
    getVaultSection: () => Promise.resolve({ section: "gameplan", content: gameplan }),
    getTasks: () => Promise.resolve({ tasks }),
    getWorkflowRuns: () => Promise.resolve({ runs }),
  } as unknown as BoundApi;
}

const GAMEPLAN = ["---", "updated: 2026-05-10", "current-phase: web-dashboard", "---", "# Plan"].join(
  "\n",
);

describe("buildActivity", () => {
  it("merges sources into a descending-by-time feed", async () => {
    const data = await buildActivity(
      stubApi(
        GAMEPLAN,
        [task({ id: "task-009", updated: "2026-05-09T00:00:00.000Z" })],
        [run({ id: "run-009", completedAt: "2026-05-12T00:00:00.000Z" })],
      ),
    );
    expect(data.feed.map((entry) => entry.id)).toEqual([
      "run:run-009",
      "vault:gameplan",
      "task:task-009",
    ]);
  });

  it("renders the run feed entry title from the real workflowName", async () => {
    const data = await buildActivity(
      stubApi(
        GAMEPLAN,
        [],
        [run({ id: "run-009", workflowName: "hotfix" })],
      ),
    );
    const runEntry = data.feed.find((entry) => entry.id === "run:run-009");
    expect(runEntry?.title).toContain("hotfix");
  });

  it("caps the feed at the 10 newest rows", async () => {
    const tasks = Array.from({ length: 15 }, (_unused, index) =>
      task({ id: `task-${index}`, updated: `2026-05-${10 + index}T00:00:00.000Z` }),
    );
    const data = await buildActivity(stubApi(GAMEPLAN, tasks, []));
    expect(data.feed).toHaveLength(10);
  });

  it("derives the paused-run and pending-task counters", async () => {
    const data = await buildActivity(
      stubApi(
        GAMEPLAN,
        [task({ status: "pending" }), task({ id: "task-002", status: "done" })],
        [run({ status: "paused" }), run({ id: "run-002", status: "running" })],
      ),
    );
    expect(data.summary).toEqual({ pausedRuns: 1, pendingTasks: 1 });
  });
});

describe("parseCurrentPhase", () => {
  it("reads current-phase from a well-formed frontmatter block", () => {
    expect(parseCurrentPhase(GAMEPLAN)).toBe("web-dashboard");
  });

  it("returns null when the frontmatter block is absent", () => {
    expect(parseCurrentPhase("# Plain document\nno frontmatter")).toBeNull();
  });

  it("returns null when the frontmatter block is unterminated", () => {
    expect(parseCurrentPhase("---\ncurrent-phase: x\n# never closed")).toBeNull();
  });

  it("returns null when the key is missing from a valid block", () => {
    expect(parseCurrentPhase("---\nupdated: 2026-05-10\n---\n# Plan")).toBeNull();
  });
});

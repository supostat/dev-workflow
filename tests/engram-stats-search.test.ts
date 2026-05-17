import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../src/lib/engram.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/engram.js")>(
    "../src/lib/engram.js",
  );
  return {
    ...actual,
    engramSearch: vi.fn(async () => []),
    engramHealth: vi.fn(async () => null),
  };
});

import { engramSearch } from "../src/lib/engram.js";
import { collectEngramStats } from "../src/lib/engram-stats.js";
import type { WorkflowRun } from "../src/workflow/types.js";

describe("collectEngramStats — live engram search call shape", () => {
  let vaultPath: string;

  beforeEach(() => {
    vi.mocked(engramSearch).mockClear();
    vaultPath = mkdtempSync(join(tmpdir(), "engram-stats-search-test-"));
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  function makeRun(id: string): WorkflowRun {
    return {
      id,
      workflowName: "dev",
      taskId: null,
      taskDescription: "test",
      phase: null,
      currentStep: "code",
      startedAt: "2026-05-11T10:00:00Z",
      completedAt: "2026-05-11T11:00:00Z",
      status: "completed",
      steps: {
        code: { status: "completed", output: "x", startedAt: null, completedAt: null, durationMs: 200, attempt: 1, engramMemoryId: null, error: null },
      },
      telemetry: { search: 1, store: 0, judge: 0, vaultRecord: 0, skipped: 0 },
    };
  }

  it("fetchTopMemoriesBestEffort calls engramSearch with (query, projectName, 5) and no tags argument", async () => {
    writeFileSync(
      join(vaultPath, "workflow-state", "runs", "run-search.json"),
      JSON.stringify(makeRun("run-search")),
      "utf-8",
    );

    await collectEngramStats(vaultPath, { projectName: "my-project" });

    expect(engramSearch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(engramSearch).mock.calls[0]!;
    expect(call).toHaveLength(3);
    expect(call[0]).toBe("recent activity");
    expect(call[1]).toBe("my-project");
    expect(call[2]).toBe(5);
    expect(call[3]).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPipelineContext,
  buildAutoTags,
  mergeTags,
} from "../src/mcp/engram-proxy.js";
import type { ProjectContext } from "../src/lib/types.js";

vi.mock("../src/lib/engram.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/engram.js")>(
    "../src/lib/engram.js",
  );
  return {
    ...actual,
    engramSearch: vi.fn(async () => []),
    engramStore: vi.fn(async () => "mem-test-id"),
    engramStoreStrict: vi.fn(async () => "mem-strict-id"),
    engramJudge: vi.fn(async () => undefined),
  };
});

import { engramSearch, engramStore, engramStoreStrict, engramJudge } from "../src/lib/engram.js";
import { ToolHandlers } from "../src/mcp/handlers.js";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { AgentContextBuilder } from "../src/agents/context-builder.js";
import { TaskManager } from "../src/tasks/manager.js";
import { TaskTracker } from "../src/tasks/tracker.js";

function createTestContext(): { context: ProjectContext; projectRoot: string } {
  const projectRoot = join(tmpdir(), `engram-proxy-test-${Date.now()}-${Math.random()}`);
  const vaultPath = join(projectRoot, ".dev-vault");
  mkdirSync(vaultPath, { recursive: true });
  return {
    projectRoot,
    context: {
      projectName: "test-project",
      branch: "feature-x",
      parentBranch: "main",
      vaultPath,
      projectRoot,
      gitRemote: null,
    },
  };
}

function createHandlers(context: ProjectContext): ToolHandlers {
  const writer = new VaultWriter(context);
  writer.scaffold();
  const reader = new VaultReader(context);
  const registry = new AgentRegistry(join(context.projectRoot, "agents-stub"));
  const contextBuilder = new AgentContextBuilder(reader, context);
  const taskManager = new TaskManager(context.vaultPath);
  const taskTracker = new TaskTracker(context.projectRoot, taskManager);
  return new ToolHandlers(
    reader, writer, context, registry, contextBuilder, taskManager, taskTracker,
  );
}

function writeActiveRun(vaultPath: string, fields: {
  id?: string;
  currentStep?: string;
  taskId?: string | null;
  status?: string;
  phase?: string | null;
}): void {
  const workflowsDir = join(vaultPath, "workflow-state", "runs");
  mkdirSync(workflowsDir, { recursive: true });
  const run = {
    id: fields.id ?? "run-001",
    workflowName: "dev",
    taskId: fields.taskId ?? null,
    taskDescription: "test",
    phase: fields.phase ?? null,
    currentStep: fields.currentStep ?? "plan",
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: fields.status ?? "running",
    steps: {},
  };
  writeFileSync(
    join(workflowsDir, `${run.id}.json`),
    JSON.stringify(run, null, 2),
    "utf-8",
  );
}

describe("buildAutoTags", () => {
  it("emits all five tags when context is fully populated (phase appended at end)", () => {
    const tags = buildAutoTags({
      branch: "main",
      step: "plan",
      runId: "run-42",
      taskId: "task-007",
      phase: "test-phase",
    });
    expect(tags).toEqual([
      "step:plan",
      "branch:main",
      "task:task-007",
      "run:run-42",
      "phase:test-phase",
    ]);
  });

  it("omits phase tag when phase is absent (4-element shape preserved)", () => {
    const tags = buildAutoTags({
      branch: "main",
      step: "plan",
      runId: "run-42",
      taskId: "task-007",
    });
    expect(tags).toEqual([
      "step:plan",
      "branch:main",
      "task:task-007",
      "run:run-42",
    ]);
  });

  it("emits phase tag alone when only phase is present", () => {
    expect(buildAutoTags({ phase: "engram-hardening" })).toEqual([
      "phase:engram-hardening",
    ]);
  });

  it("skips missing fields, keeping order stable", () => {
    expect(buildAutoTags({ branch: "main" })).toEqual(["branch:main"]);
    expect(buildAutoTags({ step: "code", branch: "feat-1" })).toEqual([
      "step:code",
      "branch:feat-1",
    ]);
    expect(buildAutoTags({})).toEqual([]);
  });
});

describe("mergeTags", () => {
  it("returns autoTags as-is when userTags absent", () => {
    expect(mergeTags(["a", "b"])).toEqual(["a", "b"]);
    expect(mergeTags(["a"], [])).toEqual(["a"]);
  });

  it("dedupes overlapping tags", () => {
    expect(mergeTags(["step:plan", "branch:main"], ["branch:main", "custom"]))
      .toEqual(["step:plan", "branch:main", "custom"]);
  });

  it("preserves user-only tags", () => {
    expect(mergeTags([], ["x", "y"])).toEqual(["x", "y"]);
  });
});

describe("loadPipelineContext", () => {
  let projectRoot: string;

  beforeEach(() => {
    delete process.env["ENGRAM_RUN_ID"];
  });

  afterEach(() => {
    delete process.env["ENGRAM_RUN_ID"];
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns branch only when no active run exists", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: undefined,
      runId: undefined,
      taskId: undefined,
      phase: undefined,
    });
  });

  it("populates step/runId/taskId from active run", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      id: "run-99",
      currentStep: "review",
      taskId: "task-005",
      status: "running",
    });
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: "review",
      runId: "run-99",
      taskId: "task-005",
      phase: undefined,
    });
  });

  it("populates phase from active run when run.phase is set", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      id: "run-phase-1",
      currentStep: "plan",
      taskId: "task-101",
      status: "running",
      phase: "test-phase",
    });
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: "plan",
      runId: "run-phase-1",
      taskId: "task-101",
      phase: "test-phase",
    });
  });

  it("returns phase undefined when run.phase is null", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      id: "run-phase-null",
      currentStep: "plan",
      taskId: "task-102",
      status: "running",
      phase: null,
    });
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: "plan",
      runId: "run-phase-null",
      taskId: "task-102",
      phase: undefined,
    });
  });

  it("falls back to branch-only when state directory has corrupt JSON", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const workflowsDir = join(env.context.vaultPath, "workflow-state", "runs");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(join(workflowsDir, "run-bad.json"), "{ broken json", "utf-8");
    // WorkflowState skips corrupt files silently — context still returns branch only
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: undefined,
      runId: undefined,
      taskId: undefined,
      phase: undefined,
    });
  });

  // ADR 2026-05-13: ENGRAM_RUN_ID env priority over state.loadCurrent()
  it("env-priority-happy-path: uses ENGRAM_RUN_ID and enriches from state", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      id: "run-abc123def456",
      currentStep: "plan",
      taskId: "task-042",
      status: "running",
      phase: "env-phase",
    });
    process.env["ENGRAM_RUN_ID"] = "run-abc123def456";
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: "plan",
      runId: "run-abc123def456",
      taskId: "task-042",
      phase: "env-phase",
    });
  });

  it("env-overrides-recent-run: env runId wins even when another run is more recent", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    // Older run — what env points to
    writeActiveRun(env.context.vaultPath, {
      id: "run-target",
      currentStep: "code",
      taskId: "task-target",
      status: "running",
    });
    // Force later startedAt for "run-recent" so loadCurrent would prefer it
    const workflowsDir = join(env.context.vaultPath, "workflow-state", "runs");
    const recent = {
      id: "run-recent",
      workflowName: "dev",
      taskId: "task-recent",
      taskDescription: "newer",
      phase: null,
      currentStep: "review",
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      completedAt: null,
      status: "running",
      steps: {},
    };
    writeFileSync(
      join(workflowsDir, `${recent.id}.json`),
      JSON.stringify(recent, null, 2),
      "utf-8",
    );
    process.env["ENGRAM_RUN_ID"] = "run-target";
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: "code",
      runId: "run-target",
      taskId: "task-target",
      phase: undefined,
    });
  });

  it("env-set-but-run-missing: returns orphan trace context (runId only)", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    process.env["ENGRAM_RUN_ID"] = "run-orphan";
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      runId: "run-orphan",
    });
  });

  it("empty-string-env-treated-as-unset: falls back to loadCurrent", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      id: "run-fallback",
      currentStep: "plan",
      taskId: "task-fb",
      status: "running",
    });
    process.env["ENGRAM_RUN_ID"] = "";
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: "plan",
      runId: "run-fallback",
      taskId: "task-fb",
      phase: undefined,
    });
  });

  it("env-not-set-current-behavior: loadCurrent returns most recent run", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      id: "run-current",
      currentStep: "verify",
      taskId: "task-curr",
      status: "running",
      phase: "current-phase",
    });
    expect(process.env["ENGRAM_RUN_ID"]).toBeUndefined();
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: "verify",
      runId: "run-current",
      taskId: "task-curr",
      phase: "current-phase",
    });
  });
});

describe("memory_search MCP handler", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramSearch).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("forwards query, project, limit, and merged auto-tags to engramSearch", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      currentStep: "plan",
      taskId: "task-001",
    });
    const handlers = createHandlers(env.context);
    await handlers.handle("memory_search", {
      query: "auth flow",
      limit: 3,
      tags: ["custom"],
    });
    expect(engramSearch).toHaveBeenCalledTimes(1);
    expect(engramSearch).toHaveBeenCalledWith(
      "auth flow",
      "test-project",
      3,
      expect.arrayContaining([
        "step:plan",
        "branch:feature-x",
        "task:task-001",
        "custom",
      ]),
    );
  });

  it("uses default limit 5 when omitted", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    await handlers.handle("memory_search", { query: "anything" });
    expect(engramSearch).toHaveBeenCalledWith(
      "anything",
      "test-project",
      5,
      expect.any(Array),
    );
  });
});

describe("memory_store MCP handler", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramStoreStrict).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("forwards merged tags as string array to engramStoreStrict", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      currentStep: "review",
    });
    const handlers = createHandlers(env.context);
    const result = await handlers.handle("memory_store", {
      context: "Found pattern",
      action: "Refactored to use proxy",
      result: "Cleaner abstraction",
      type: "pattern",
      tags: ["arch"],
    });
    expect(engramStoreStrict).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(engramStoreStrict).mock.calls[0]!;
    expect(callArgs[0]).toBe("Found pattern");
    expect(callArgs[1]).toBe("Refactored to use proxy");
    expect(callArgs[2]).toBe("Cleaner abstraction");
    expect(callArgs[3]).toBe("pattern");
    const tagsArg = callArgs[4];
    expect(Array.isArray(tagsArg)).toBe(true);
    expect(tagsArg).toContain("step:review");
    expect(tagsArg).toContain("branch:feature-x");
    expect(tagsArg).toContain("arch");
    expect(callArgs[5]).toBe("test-project");
    expect(result).toEqual({ id: "mem-strict-id" });
  });
});

describe("memory_store handler — strict error surfacing (ADR 2026-05-06)", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramStoreStrict).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns id on successful engramStoreStrict", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    vi.mocked(engramStoreStrict).mockResolvedValueOnce("mem-success-1");

    const result = await handlers.handle("memory_store", {
      context: "test",
      action: "test",
      result: "test",
      type: "context",
    }) as { id: string };

    expect(result.id).toBe("mem-success-1");
  });

  it("propagates daemon error message via thrown Error", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    vi.mocked(engramStoreStrict).mockRejectedValueOnce(
      new Error("engram memory_store: embedding api unavailable: 403 Forbidden"),
    );

    await expect(
      handlers.handle("memory_store", {
        context: "test",
        action: "test",
        result: "test",
        type: "context",
      }),
    ).rejects.toThrow(/embedding api unavailable.*403/);
  });

  it("throws when daemon returns response without id (empty-id contract violation)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    vi.mocked(engramStoreStrict).mockRejectedValueOnce(
      new Error("engram memory_store: response missing id"),
    );

    await expect(
      handlers.handle("memory_store", {
        context: "test",
        action: "test",
        result: "test",
        type: "context",
      }),
    ).rejects.toThrow(/response missing id/);
  });

  it("does not call engramStoreStrict when tag-validation fails", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("memory_store", {
        context: "test",
        action: "test",
        result: "test",
        type: "context",
        tags: ["bad,tag"],
      }),
    ).rejects.toThrow(/must not contain commas/);

    expect(vi.mocked(engramStoreStrict)).not.toHaveBeenCalled();
  });

  it("error lists all missing fields and explains the four-field contract", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("memory_store", {
        context: "all in one blob, forgot the rest",
      }),
    ).rejects.toThrow(
      /memory_store requires four non-empty string fields.*Missing or empty: action, result, type.*tools\/list/s,
    );

    expect(vi.mocked(engramStoreStrict)).not.toHaveBeenCalled();
  });

  it("error names the single missing field when three of four are present", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("memory_store", {
        context: "x",
        result: "y",
        type: "pattern",
      }),
    ).rejects.toThrow(/Missing or empty: action\b/);

    expect(vi.mocked(engramStoreStrict)).not.toHaveBeenCalled();
  });

  it("rejects empty-string fields, not just missing ones", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("memory_store", {
        context: "x",
        action: "",
        result: "y",
        type: "pattern",
      }),
    ).rejects.toThrow(/Missing or empty: action/);

    expect(vi.mocked(engramStoreStrict)).not.toHaveBeenCalled();
  });
});

describe("memory_judge MCP handler", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramJudge).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("delegates with explanation defaulting to empty string when omitted", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    const result = await handlers.handle("memory_judge", {
      memory_id: "mem-42",
      score: 0.8,
    });
    expect(engramJudge).toHaveBeenCalledWith("mem-42", 0.8, "");
    expect(result).toEqual({ ok: true });
  });

  it("forwards explicit explanation", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    await handlers.handle("memory_judge", {
      memory_id: "mem-7",
      score: 0.3,
      explanation: "marginal",
    });
    expect(engramJudge).toHaveBeenCalledWith("mem-7", 0.3, "marginal");
  });

  it("accepts boundary score=0", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    await handlers.handle("memory_judge", { memory_id: "mem-low", score: 0 });
    expect(engramJudge).toHaveBeenCalledWith("mem-low", 0, "");
  });

  it("accepts boundary score=1", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    await handlers.handle("memory_judge", { memory_id: "mem-top", score: 1 });
    expect(engramJudge).toHaveBeenCalledWith("mem-top", 1, "");
  });

  it("rejects non-finite score (NaN, Infinity)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    await expect(
      handlers.handle("memory_judge", { memory_id: "mem-x", score: "abc" }),
    ).rejects.toThrow(/score must be a finite number/);
    await expect(
      handlers.handle("memory_judge", { memory_id: "mem-x", score: Infinity }),
    ).rejects.toThrow(/score must be a finite number/);
  });

  it("rejects out-of-range score", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    await expect(
      handlers.handle("memory_judge", { memory_id: "mem-x", score: -0.1 }),
    ).rejects.toThrow(/in \[0, 1\]/);
    await expect(
      handlers.handle("memory_judge", { memory_id: "mem-x", score: 1.5 }),
    ).rejects.toThrow(/in \[0, 1\]/);
  });
});

describe("loadPipelineContext — additional cases", () => {
  let projectRoot: string;

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("ignores completed runs (only running/paused match)", () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    writeActiveRun(env.context.vaultPath, {
      id: "run-old",
      currentStep: "commit",
      status: "completed",
    });
    expect(loadPipelineContext(env.context)).toEqual({
      branch: "feature-x",
      step: undefined,
      runId: undefined,
      taskId: undefined,
      phase: undefined,
    });
  });
});

describe("memory_search/store handlers — extra edge cases", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramSearch).mockClear();
    vi.mocked(engramStore).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("memory_search dedupes user-provided duplicate tags", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    await handlers.handle("memory_search", {
      query: "x",
      tags: ["custom", "custom", "branch:feature-x"],
    });
    const tagsArg = vi.mocked(engramSearch).mock.calls[0]![3]!;
    const customCount = tagsArg.filter((t) => t === "custom").length;
    const branchCount = tagsArg.filter((t) => t === "branch:feature-x").length;
    expect(customCount).toBe(1);
    expect(branchCount).toBe(1);
  });

  it("memory_search treats null tags param as missing", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);
    await handlers.handle("memory_search", { query: "y", tags: null as unknown as string[] });
    expect(engramSearch).toHaveBeenCalledWith("y", "test-project", 5, expect.any(Array));
  });

  it("memory_search propagates engram failures as empty array (not throws)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    vi.mocked(engramSearch).mockResolvedValueOnce([]);
    const handlers = createHandlers(env.context);
    const result = await handlers.handle("memory_search", { query: "z" });
    expect(result).toEqual([]);
  });
});

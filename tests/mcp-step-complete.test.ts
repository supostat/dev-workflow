import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

import { engramJudge } from "../src/lib/engram.js";
import { ToolHandlers } from "../src/mcp/handlers.js";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { AgentContextBuilder } from "../src/agents/context-builder.js";
import { TaskManager } from "../src/tasks/manager.js";
import { TaskTracker } from "../src/tasks/tracker.js";

function createTestContext(): { context: ProjectContext; projectRoot: string } {
  const projectRoot = join(tmpdir(), `step-complete-test-${Date.now()}-${Math.random()}`);
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

const UUID_A = "11111111-2222-3333-4444-555555555555";
const UUID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const UUID_C = "99999999-8888-7777-6666-555555555555";
const UUID_D = "12345678-9abc-def0-1234-56789abcdef0";
const UUID_E = "deadbeef-cafe-babe-feed-0123456789ab";
const UUID_F = "fafafafa-0b0b-0c0c-0d0d-0e0e0f0f0a0a";

interface StepCompleteResult {
  judgmentsApplied: number;
  fallbackIds: string[];
  antipatternIdsInBefore: string[];
  antipatternJudgmentDistribution: Record<string, number>;
}

describe("step_complete MCP handler — happy path", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramJudge).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("applies all three judgments when feedback section covers all memories", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const output = [
      "some agent body",
      "",
      "## Engram Feedback",
      `- ${UUID_A}: 0.9 — directly applied`,
      `- ${UUID_B}: 0.5 — context only`,
      `- ${UUID_C}: 0.1 — not useful`,
    ].join("\n");

    const result = await handlers.handle("step_complete", {
      stepName: "code",
      beforeSearchMemoryIds: [
        { id: UUID_A, memoryType: "pattern" },
        { id: UUID_B, memoryType: "decision" },
        { id: UUID_C, memoryType: "context" },
      ],
      output,
    }) as StepCompleteResult;

    expect(result.judgmentsApplied).toBe(3);
    expect(result.fallbackIds).toEqual([]);
    expect(result.antipatternIdsInBefore).toEqual([]);
    expect(result.antipatternJudgmentDistribution).toEqual({});
    expect(engramJudge).toHaveBeenCalledTimes(3);
    expect(engramJudge).toHaveBeenCalledWith(UUID_A, 0.9, "directly applied");
    expect(engramJudge).toHaveBeenCalledWith(UUID_B, 0.5, "context only");
    expect(engramJudge).toHaveBeenCalledWith(UUID_C, 0.1, "not useful");
  });

  it("returns fallbackIds for memories without feedback lines (no blanket judge applied)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const output = [
      "## Engram Feedback",
      `- ${UUID_A}: 0.7 — used`,
      `- ${UUID_B}: 0.3 — marginal`,
    ].join("\n");

    const result = await handlers.handle("step_complete", {
      stepName: "code",
      beforeSearchMemoryIds: [
        { id: UUID_A, memoryType: "pattern" },
        { id: UUID_B, memoryType: "pattern" },
        { id: UUID_C, memoryType: "pattern" },
      ],
      output,
    }) as StepCompleteResult;

    expect(result.judgmentsApplied).toBe(2);
    expect(result.fallbackIds).toEqual([UUID_C]);
    expect(engramJudge).toHaveBeenCalledTimes(2);
    expect(engramJudge).toHaveBeenCalledWith(UUID_A, 0.7, "used");
    expect(engramJudge).toHaveBeenCalledWith(UUID_B, 0.3, "marginal");
    expect(engramJudge).not.toHaveBeenCalledWith(UUID_C, expect.anything(), expect.anything());
  });

  it("returns all ids in fallbackIds when feedback section is missing (no blanket fallback)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const result = await handlers.handle("step_complete", {
      stepName: "code",
      beforeSearchMemoryIds: [
        { id: UUID_A, memoryType: "pattern" },
        { id: UUID_B, memoryType: "decision" },
      ],
      output: "just a body, no Engram Feedback heading",
    }) as StepCompleteResult;

    expect(result.judgmentsApplied).toBe(0);
    expect(result.fallbackIds).toEqual([UUID_A, UUID_B]);
    expect(engramJudge).not.toHaveBeenCalled();
  });

  it("returns empty result and skips judge calls when beforeSearchMemoryIds is empty", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const result = await handlers.handle("step_complete", {
      stepName: "code",
      beforeSearchMemoryIds: [],
      output: "## Engram Feedback\n- whatever: 0.5 — meh",
    }) as StepCompleteResult;

    expect(result.judgmentsApplied).toBe(0);
    expect(result.fallbackIds).toEqual([]);
    expect(result.antipatternIdsInBefore).toEqual([]);
    expect(result.antipatternJudgmentDistribution).toEqual({});
    expect(engramJudge).not.toHaveBeenCalled();
  });
});

describe("step_complete MCP handler — antipattern observability", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramJudge).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("counts only antipattern-judgment scores in distribution buckets (excludes non-antipattern scores)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    // Two antipatterns scored 0.1 and 0.9.
    // Three non-antipatterns scored 0.5, 0.7, 0.3 — these scores would land in
    // "0.4-0.6", "0.6-0.8", "0.2-0.4" if the bucket filter were broken. Their
    // explicit absence (count=0) proves the filter excludes non-antipattern memories.
    const output = [
      "## Engram Feedback",
      `- ${UUID_A}: 0.1 — antipattern, low usefulness`,
      `- ${UUID_B}: 0.9 — antipattern, very useful`,
      `- ${UUID_C}: 0.5 — pattern, MUST NOT appear in 0.4-0.6 bucket`,
      `- ${UUID_D}: 0.7 — decision, MUST NOT appear in 0.6-0.8 bucket`,
      `- ${UUID_E}: 0.3 — pattern, MUST NOT appear in 0.2-0.4 bucket`,
    ].join("\n");

    const result = await handlers.handle("step_complete", {
      stepName: "review",
      beforeSearchMemoryIds: [
        { id: UUID_A, memoryType: "antipattern" },
        { id: UUID_B, memoryType: "antipattern" },
        { id: UUID_C, memoryType: "pattern" },
        { id: UUID_D, memoryType: "decision" },
        { id: UUID_E, memoryType: "pattern" },
      ],
      output,
    }) as StepCompleteResult;

    expect(result.judgmentsApplied).toBe(5);
    expect(result.antipatternIdsInBefore).toEqual([UUID_A, UUID_B]);
    // Only antipattern scores 0.1 and 0.9 contribute. Non-antipattern scores
    // 0.3 / 0.5 / 0.7 are explicitly excluded — corresponding buckets are 0.
    expect(result.antipatternJudgmentDistribution).toEqual({
      "0.0-0.2": 1,
      "0.2-0.4": 0,
      "0.4-0.6": 0,
      "0.6-0.8": 0,
      "0.8-1.0": 1,
    });
  });

  it("places boundary scores 0.0, 0.2, 0.4, 0.6, 0.8 in left-closed buckets", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const output = [
      "## Engram Feedback",
      `- ${UUID_A}: 0.2 — boundary 0.2`,
      `- ${UUID_B}: 0.6 — boundary 0.6`,
      `- ${UUID_C}: 0.8 — boundary 0.8`,
      `- ${UUID_D}: 0.0 — boundary 0.0`,
      `- ${UUID_E}: 0.4 — boundary 0.4`,
    ].join("\n");

    const result = await handlers.handle("step_complete", {
      stepName: "review",
      beforeSearchMemoryIds: [
        { id: UUID_A, memoryType: "antipattern" },
        { id: UUID_B, memoryType: "antipattern" },
        { id: UUID_C, memoryType: "antipattern" },
        { id: UUID_D, memoryType: "antipattern" },
        { id: UUID_E, memoryType: "antipattern" },
      ],
      output,
    }) as StepCompleteResult;

    expect(result.antipatternJudgmentDistribution).toEqual({
      "0.0-0.2": 1, // UUID_D = 0.0 (left-closed)
      "0.2-0.4": 1, // UUID_A = 0.2 (left-closed)
      "0.4-0.6": 1, // UUID_E = 0.4 (left-closed)
      "0.6-0.8": 1, // UUID_B = 0.6 (left-closed)
      "0.8-1.0": 1, // UUID_C = 0.8 (left-closed)
    });
  });

  it("places score 1.0 in the top bucket 0.8-1.0 (inclusive at top)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const output = [
      "## Engram Feedback",
      `- ${UUID_A}: 1.0 — perfect`,
    ].join("\n");

    const result = await handlers.handle("step_complete", {
      stepName: "review",
      beforeSearchMemoryIds: [
        { id: UUID_A, memoryType: "antipattern" },
      ],
      output,
    }) as StepCompleteResult;

    expect(result.antipatternJudgmentDistribution["0.8-1.0"]).toBe(1);
  });

  it("filters antipatternIdsInBefore from enriched objects (mixed memoryTypes)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const result = await handlers.handle("step_complete", {
      stepName: "code",
      beforeSearchMemoryIds: [
        { id: UUID_A, memoryType: "antipattern" },
        { id: UUID_B, memoryType: "pattern" },
        { id: UUID_C, memoryType: "decision" },
      ],
      output: "no feedback section here",
    }) as StepCompleteResult;

    expect(result.antipatternIdsInBefore).toEqual([UUID_A]);
  });

  it("returns empty (not zero-bucket) distribution when scope has no antipatterns", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const output = [
      "## Engram Feedback",
      `- ${UUID_A}: 0.8 — pattern was useful`,
    ].join("\n");

    const result = await handlers.handle("step_complete", {
      stepName: "code",
      beforeSearchMemoryIds: [{ id: UUID_A, memoryType: "pattern" }],
      output,
    }) as StepCompleteResult;

    // Scope had no antipatterns → distribution is empty {}, NOT the 5-bucket
    // zero shape. This shape distinction signals "nothing to track" vs
    // "antipatterns existed but received no feedback".
    expect(result.antipatternIdsInBefore).toEqual([]);
    expect(result.antipatternJudgmentDistribution).toEqual({});
  });
});

describe("step_complete MCP handler — validation", () => {
  let projectRoot: string;

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("throws when an id is not a valid UUID", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("step_complete", {
        stepName: "code",
        beforeSearchMemoryIds: [{ id: "not-a-uuid", memoryType: "pattern" }],
        output: "body",
      }),
    ).rejects.toThrow(/must be a UUID/);
  });

  it("throws when an item is missing memoryType", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("step_complete", {
        stepName: "code",
        beforeSearchMemoryIds: [{ id: UUID_A }],
        output: "body",
      }),
    ).rejects.toThrow(/memoryType/);
  });

  it("throws when an item is missing id", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("step_complete", {
        stepName: "code",
        beforeSearchMemoryIds: [{ memoryType: "pattern" }],
        output: "body",
      }),
    ).rejects.toThrow(/id/);
  });

  it("throws when output is not a string", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("step_complete", {
        stepName: "code",
        beforeSearchMemoryIds: [],
        output: 12345,
      }),
    ).rejects.toThrow(/output must be a string/);
  });

  it("throws when stepName is missing or empty", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("step_complete", {
        beforeSearchMemoryIds: [],
        output: "body",
      }),
    ).rejects.toThrow(/stepName/);
  });

  it("throws when output exceeds 50000 bytes (DoS defense-in-depth)", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    await expect(
      handlers.handle("step_complete", {
        stepName: "code",
        beforeSearchMemoryIds: [],
        output: "x".repeat(50_001),
      }),
    ).rejects.toThrow(/output exceeds 50000 bytes/);
  });
});

describe("step_complete MCP handler — runId optional", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramJudge).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("accepts optional runId parameter without altering behavior", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    const output = [
      "## Engram Feedback",
      `- ${UUID_A}: 0.6 — used`,
    ].join("\n");

    const result = await handlers.handle("step_complete", {
      stepName: "code",
      runId: "run-007",
      beforeSearchMemoryIds: [{ id: UUID_A, memoryType: "pattern" }],
      output,
    }) as StepCompleteResult;

    expect(result.judgmentsApplied).toBe(1);
    expect(engramJudge).toHaveBeenCalledWith(UUID_A, 0.6, "used");
  });
});

describe("step_complete MCP handler — JUDGE_CAP enforcement", () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.mocked(engramJudge).mockClear();
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("caps engramJudge invocations at 20 even when 25 valid judgments are present", async () => {
    const env = createTestContext();
    projectRoot = env.projectRoot;
    const handlers = createHandlers(env.context);

    // Generate 25 UUIDs.
    const ids = Array.from({ length: 25 }, (_, i) => {
      const hex = i.toString(16).padStart(2, "0");
      return `${hex}${hex}${hex}${hex}-${hex}${hex}-${hex}${hex}-${hex}${hex}-${hex}${hex}${hex}${hex}${hex}${hex}`;
    });

    const feedbackLines = ids.map((id, i) => {
      const score = (i / 25).toFixed(2);
      return `- ${id}: ${score} — generated`;
    });
    const output = ["## Engram Feedback", ...feedbackLines].join("\n");

    const result = await handlers.handle("step_complete", {
      stepName: "code",
      beforeSearchMemoryIds: ids.map((id) => ({ id, memoryType: "pattern" })),
      output,
    }) as StepCompleteResult;

    // judgmentsApplied counts judge invocations actually made (capped at 20).
    expect(result.judgmentsApplied).toBe(20);
    expect(engramJudge).toHaveBeenCalledTimes(20);
  });
});

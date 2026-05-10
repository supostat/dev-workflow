import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "../src/mcp/server.js";
import { ToolHandlers } from "../src/mcp/handlers.js";
import { getToolDefinitions } from "../src/mcp/tools.js";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { AgentContextBuilder } from "../src/agents/context-builder.js";
import { TaskManager } from "../src/tasks/manager.js";
import { TaskTracker } from "../src/tasks/tracker.js";
import { parseWorkflowYaml } from "../src/workflow/loader.js";
import type { ProjectContext } from "../src/lib/types.js";

function createTestEnv() {
  const projectRoot = join(tmpdir(), `dev-vault-mcp-test-${Date.now()}`);
  const vaultPath = join(projectRoot, ".dev-vault");

  const context: ProjectContext = {
    projectName: "test-project",
    branch: "main",
    parentBranch: "main",
    vaultPath,
    projectRoot,
    gitRemote: null,
  };

  const writer = new VaultWriter(context);
  writer.scaffold();

  const agentsDir = join(projectRoot, "test-agents");
  mkdirSync(agentsDir, { recursive: true });
  for (const name of ["reader", "planner", "coder", "reviewer", "tester", "committer"]) {
    writeFileSync(join(agentsDir, `${name}.md`), `---
name: ${name}
description: Test ${name}
vault: [stack]
---
Agent {{projectName}}: {{taskDescription}}
`, "utf-8");
  }

  const vaultReader = new VaultReader(context);
  const registry = new AgentRegistry(agentsDir);
  const contextBuilder = new AgentContextBuilder(vaultReader, context);
  const taskManager = new TaskManager(vaultPath);
  const taskTracker = new TaskTracker(projectRoot, taskManager);
  const handlers = new ToolHandlers(
    vaultReader, writer, context, registry, contextBuilder, taskManager,
    taskTracker,
  );

  return { projectRoot, context, handlers, taskManager, agentsDir };
}

describe("getToolDefinitions", () => {
  it("returns 23 tool definitions", () => {
    const tools = getToolDefinitions();
    expect(tools).toHaveLength(23);
  });

  it("includes profile_get / profile_set / profile_clear", () => {
    const names = getToolDefinitions().map((t) => t.name);
    expect(names).toContain("profile_get");
    expect(names).toContain("profile_set");
    expect(names).toContain("profile_clear");
  });

  it("includes vault_pattern", () => {
    const tools = getToolDefinitions();
    expect(tools.map((t) => t.name)).toContain("vault_pattern");
  });

  it("each tool has name, description, and inputSchema", () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("ToolHandlers", () => {
  let env: ReturnType<typeof createTestEnv>;
  let originalEngramSocket: string | undefined;

  beforeEach(() => {
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    env = createTestEnv();
  });

  afterEach(() => {
    rmSync(env.projectRoot, { recursive: true, force: true });
    if (originalEngramSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEngramSocket;
    }
  });

  it("vault_read returns stack content", async () => {
    const result = await env.handlers.handle("vault_read", { section: "stack" });
    expect(result).toContain("Stack");
  });

  it("vault_read throws for unknown section", async () => {
    await expect(env.handlers.handle("vault_read", { section: "nonexistent" }))
      .rejects.toThrow("Unknown vault section");
  });

  it("vault_search finds text in vault", async () => {
    const result = await env.handlers.handle("vault_search", { query: "Stack" }) as Array<unknown>;
    expect(result.length).toBeGreaterThan(0);
  });

  it("vault_search returns empty for no match", async () => {
    const result = await env.handlers.handle("vault_search", { query: "xyznonexistent123" }) as Array<unknown>;
    expect(result).toHaveLength(0);
  });

  it("vault_record creates ADR file", async () => {
    const result = await env.handlers.handle("vault_record", {
      type: "adr",
      title: "Use TypeScript",
      content: "We chose TypeScript for type safety.",
    }) as { filepath: string };

    expect(result.filepath).toContain("architecture");
    expect(result.filepath).toContain("use-typescript");
  });

  it("vault_record rejects invalid type", async () => {
    await expect(env.handlers.handle("vault_record", {
      type: "invalid",
      title: "x",
      content: "y",
    })).rejects.toThrow(/invalid type "invalid"/);
  });

  it("vault_record bumps telemetry counters on the active workflow run", async () => {
    const workflowsDir = join(env.context.vaultPath, "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    const run = {
      id: "run-mirror-test",
      workflowName: "dev",
      taskId: null,
      taskDescription: "test",
      currentStep: "code",
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: "running",
      steps: {},
    };
    writeFileSync(join(workflowsDir, `${run.id}.json`), JSON.stringify(run, null, 2), "utf-8");

    await env.handlers.handle("vault_record", {
      type: "adr",
      title: "Telemetry test record",
      content: "some content",
    });

    const reloaded = JSON.parse(readFileSync(join(workflowsDir, `${run.id}.json`), "utf-8")) as {
      telemetry?: { vaultRecord: number; store: number; skipped: number };
    };
    expect(reloaded.telemetry).toBeDefined();
    expect(reloaded.telemetry!.vaultRecord).toBe(1);
    // Engram is stubbed to /tmp/no-such-socket → store fails → mirror returns stored=false → store counter stays 0
    expect(reloaded.telemetry!.store).toBe(0);
    expect(reloaded.telemetry!.skipped).toBe(0);
  });

  it("memory_store rejects tags containing commas or newlines", async () => {
    await expect(env.handlers.handle("memory_store", {
      context: "ctx", action: "act", result: "res", type: "pattern",
      tags: ["valid", "bad,tag"],
    })).rejects.toThrow(/must not contain commas or newlines/);

    await expect(env.handlers.handle("memory_store", {
      context: "ctx", action: "act", result: "res", type: "pattern",
      tags: ["bad\nnewline"],
    })).rejects.toThrow(/must not contain commas or newlines/);
  });

  it("memory_search rejects tags containing commas or newlines", async () => {
    await expect(env.handlers.handle("memory_search", {
      query: "x", tags: ["a,b"],
    })).rejects.toThrow(/must not contain commas or newlines/);
  });

  it("vault_knowledge appends to knowledge.md", async () => {
    await env.handlers.handle("vault_knowledge", {
      section: "Gotchas",
      content: "- Watch out for ESM imports",
    });

    const reader = new VaultReader(env.context);
    const knowledge = reader.readKnowledge();
    expect(knowledge).toContain("Watch out for ESM imports");
  });

  it("vault_pattern appends to conventions.md default Patterns section", async () => {
    const conventionsPath = join(env.context.vaultPath, "conventions.md");
    writeFileSync(
      conventionsPath,
      "# Conventions\n\n## Patterns\n\n- existing\n",
      "utf-8",
    );

    const result = await env.handlers.handle("vault_pattern", {
      content: "- new convention",
    }) as { success: boolean; appended: boolean };

    expect(result).toEqual({ success: true, appended: true });
    expect(readFileSync(conventionsPath, "utf-8")).toContain("- new convention");
  });

  it("vault_pattern accepts explicit section override", async () => {
    const conventionsPath = join(env.context.vaultPath, "conventions.md");
    writeFileSync(
      conventionsPath,
      "# Conventions\n\n## Patterns\n\n- p\n\n## Testing\n\n- t\n",
      "utf-8",
    );

    const result = await env.handlers.handle("vault_pattern", {
      section: "Testing",
      content: "- new test rule",
    }) as { success: boolean; appended: boolean };

    expect(result).toEqual({ success: true, appended: true });
    expect(readFileSync(conventionsPath, "utf-8")).toContain("- new test rule");
  });

  it("vault_pattern reports section-missing without throwing", async () => {
    const conventionsPath = join(env.context.vaultPath, "conventions.md");
    writeFileSync(conventionsPath, "# Conventions\n\n## Git\n\n- rule\n", "utf-8");

    const result = await env.handlers.handle("vault_pattern", {
      content: "- nope",
    }) as { success: boolean; appended: boolean; reason: string };

    expect(result).toEqual({ success: true, appended: false, reason: "section-missing" });
  });

  it("vault_pattern reports duplicate without throwing", async () => {
    const conventionsPath = join(env.context.vaultPath, "conventions.md");
    const initial = "# Conventions\n\n## Patterns\n\n- already-here\n";
    writeFileSync(conventionsPath, initial, "utf-8");

    const result = await env.handlers.handle("vault_pattern", {
      content: "- already-here",
    }) as { success: boolean; appended: boolean; reason: string };

    expect(result).toEqual({ success: true, appended: false, reason: "duplicate" });
    expect(readFileSync(conventionsPath, "utf-8")).toBe(initial);
  });

  it("vault_pattern rejects multi-line content", async () => {
    await expect(env.handlers.handle("vault_pattern", {
      content: "- line one\n- line two",
    })).rejects.toThrow(/content must be a single line/);
  });

  it("vault_pattern rejects multi-line section", async () => {
    await expect(env.handlers.handle("vault_pattern", {
      section: "Patterns\n## Injected",
      content: "- rule",
    })).rejects.toThrow(/section must be a single line/);
  });

  it("vault_pattern leaves conventions.md unchanged when appended is false", async () => {
    const conventionsPath = join(env.context.vaultPath, "conventions.md");
    const initial = "# Conventions\n\n## Git\n\n- rule\n";
    writeFileSync(conventionsPath, initial, "utf-8");

    await env.handlers.handle("vault_pattern", { content: "- rejected" });

    expect(readFileSync(conventionsPath, "utf-8")).toBe(initial);
  });

  it("task_create creates a new task", async () => {
    const result = await env.handlers.handle("task_create", {
      title: "Build feature",
      description: "Implement the thing",
    }) as { id: string; title: string };

    expect(result.id).toBe("task-001");
    expect(result.title).toBe("Build feature");
  });

  it("task_list returns tasks", async () => {
    await env.handlers.handle("task_create", { title: "Task A" });
    await env.handlers.handle("task_create", { title: "Task B" });

    const result = await env.handlers.handle("task_list", {}) as Array<unknown>;
    expect(result).toHaveLength(2);
  });

  it("task_update changes status", async () => {
    await env.handlers.handle("task_create", { title: "Task" });
    const result = await env.handlers.handle("task_update", {
      id: "task-001",
      status: "in-progress",
    }) as { status: string };

    expect(result.status).toBe("in-progress");
  });

  it("agent_list returns 6 agents", async () => {
    const result = await env.handlers.handle("agent_list", {}) as Array<{ name: string }>;
    expect(result).toHaveLength(6);
  });

  it("agent_run returns prepared prompt", async () => {
    const result = await env.handlers.handle("agent_run", {
      agent: "coder",
      task: "Build login page",
    }) as { prompt: string; permissions: unknown };

    expect(result.prompt).toContain("test-project");
    expect(result.prompt).toContain("Build login page");
    expect(result.permissions).toBeTruthy();
  });

  it("parse_engram_feedback converts Map to Array for JSON", async () => {
    const output = [
      "findings body",
      "",
      "## Engram Feedback",
      "- mem-1: 0.8 — applied pattern",
      "- mem-2: 0.2 — not useful",
    ].join("\n");
    const result = await env.handlers.handle("parse_engram_feedback", {
      output,
      expectedMemoryIds: ["mem-1", "mem-2"],
    }) as {
      judgments: Array<{ id: string; score: number; explanation: string }>;
      fallbackIds: string[];
    };
    expect(result.judgments).toEqual([
      { id: "mem-1", score: 0.8, explanation: "applied pattern" },
      { id: "mem-2", score: 0.2, explanation: "not useful" },
    ]);
    expect(result.fallbackIds).toEqual([]);
  });

  it("parse_engram_feedback returns fallbackIds when section missing", async () => {
    const result = await env.handlers.handle("parse_engram_feedback", {
      output: "just a body, no Engram Feedback section",
      expectedMemoryIds: ["mem-a", "mem-b"],
    }) as { judgments: unknown[]; fallbackIds: string[] };
    expect(result.judgments).toEqual([]);
    expect(result.fallbackIds).toEqual(["mem-a", "mem-b"]);
  });

  it("parse_engram_feedback tolerates non-array expectedMemoryIds", async () => {
    const result = await env.handlers.handle("parse_engram_feedback", {
      output: "## Engram Feedback\n- x: 0.5 — y",
      expectedMemoryIds: "not-an-array" as unknown,
    }) as { judgments: unknown[]; fallbackIds: string[] };
    expect(result.judgments).toEqual([]);
    expect(result.fallbackIds).toEqual([]);
  });

  it("vault_status returns structured status", async () => {
    const result = await env.handlers.handle("vault_status", {}) as {
      project: string;
      branch: string;
      sections: Record<string, { filled: boolean; lines: number }>;
      tasks: { total: number };
    };

    expect(result.project).toBe("test-project");
    expect(result.branch).toBe("main");
    expect(result.sections.stack).toBeDefined();
    expect(result.sections.conventions).toBeDefined();
    expect(result.sections.knowledge).toBeDefined();
    expect(result.sections.gameplan).toBeDefined();
    expect(result.tasks.total).toBe(0);
  });

  it("intelligence_query returns scored patterns", async () => {
    const result = await env.handlers.handle("intelligence_query", {
      branch: "main",
      task: "test query",
      limit: 5,
    }) as Array<{ id: string; score: number }>;

    expect(Array.isArray(result)).toBe(true);
  });

  it("intelligence_query works without parameters", async () => {
    const result = await env.handlers.handle("intelligence_query", {}) as Array<unknown>;
    expect(Array.isArray(result)).toBe(true);
  });

  it("task_start links task to branch", async () => {
    await env.handlers.handle("task_create", { title: "My Feature" });
    const result = await env.handlers.handle("task_start", {
      id: "task-001",
    }) as { id: string; status: string; branch: string };

    expect(result.id).toBe("task-001");
    expect(result.status).toBe("in-progress");
    expect(result.branch).toBe("task/my-feature");
  });

  it("task_start throws for unknown task", async () => {
    await expect(env.handlers.handle("task_start", { id: "task-999" }))
      .rejects.toThrow();
  });

  it("workflow_create writes YAML to .dev-vault/workflows/<name>.yaml on valid input", async () => {
    const result = await env.handlers.handle("workflow_create", {
      name: "my-flow",
      description: "Custom pipeline",
      steps: [
        { name: "read", agent: "reader" },
        { name: "code", agent: "coder", input: ["read.output"] },
      ],
    }) as { filepath: string };

    const expectedPath = join(env.context.vaultPath, "workflows", "my-flow.yaml");
    expect(result.filepath).toBe(expectedPath);

    const content = readFileSync(expectedPath, "utf-8");
    expect(content).toContain("name: my-flow");
    expect(content).toContain("description: Custom pipeline");
    expect(content).toContain("- name: read");
    expect(content).toContain("agent: reader");
    expect(content).toContain("input: [read.output]");
  });

  it("workflow_create throws on invalid name (uppercase or special chars)", async () => {
    await expect(env.handlers.handle("workflow_create", {
      name: "MyFlow",
      description: "Invalid",
      steps: [{ name: "read", agent: "reader" }],
    })).rejects.toThrow(/Invalid workflow name/);

    await expect(env.handlers.handle("workflow_create", {
      name: "bad name!",
      description: "Invalid",
      steps: [{ name: "read", agent: "reader" }],
    })).rejects.toThrow(/Invalid workflow name/);
  });

  it("workflow_create throws when file already exists", async () => {
    await env.handlers.handle("workflow_create", {
      name: "dupe-flow",
      description: "First write",
      steps: [{ name: "read", agent: "reader" }],
    });

    await expect(env.handlers.handle("workflow_create", {
      name: "dupe-flow",
      description: "Second write",
      steps: [{ name: "read", agent: "reader" }],
    })).rejects.toThrow(/already exists/);
  });

  it("workflow_create throws when onFail references non-existent step", async () => {
    await expect(env.handlers.handle("workflow_create", {
      name: "bad-onfail",
      description: "Broken onFail",
      steps: [
        { name: "read", agent: "reader" },
        { name: "code", agent: "coder", onFail: "nonexistent" },
      ],
    })).rejects.toThrow(/onFail references unknown step "nonexistent"/);
  });

  it("workflow_create throws on empty steps array", async () => {
    await expect(env.handlers.handle("workflow_create", {
      name: "empty-flow",
      description: "No steps",
      steps: [],
    })).rejects.toThrow(/at least 1 step/);
  });

  it("workflow_create serializes + round-trips correctly (full step with gate/input/outputBlock)", async () => {
    const result = await env.handlers.handle("workflow_create", {
      name: "full-flow",
      description: "Full round-trip",
      match: ["src/**/*.ts"],
      steps: [
        { name: "read", agent: "reader" },
        {
          name: "plan",
          agent: "planner",
          input: ["read.output"],
          gate: "user-approve",
        },
        {
          name: "code",
          agent: "coder",
          input: ["read.output", "plan.output"],
          gate: "review-pass",
          onFail: "plan",
          maxAttempts: 5,
          subagent: "Full",
          outputBlock: "CODE_DONE",
        },
      ],
    }) as { filepath: string };

    const content = readFileSync(result.filepath, "utf-8");
    const parsed = parseWorkflowYaml(content);

    expect(parsed.name).toBe("full-flow");
    expect(parsed.description).toBe("Full round-trip");
    expect(parsed.match).toEqual(["src/**/*.ts"]);
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.steps[2]!.gate).toBe("review-pass");
    expect(parsed.steps[2]!.onFail).toBe("plan");
    expect(parsed.steps[2]!.maxAttempts).toBe(5);
    expect(parsed.steps[2]!.subagent).toBe("Full");
    expect(parsed.steps[2]!.outputBlock).toBe("CODE_DONE");
    expect(parsed.steps[2]!.input).toEqual(["read.output", "plan.output"]);
  });

  it("workflow_create throws on invalid gate enum value", async () => {
    await expect(env.handlers.handle("workflow_create", {
      name: "bad-gate-flow",
      description: "Test workflow",
      steps: [{ name: "x", agent: "reader", gate: "invalid-gate" }],
    })).rejects.toThrow(/invalid gate/);
  });

  it("workflow_create throws on invalid subagent enum value", async () => {
    await expect(env.handlers.handle("workflow_create", {
      name: "bad-subagent-flow",
      description: "Test workflow",
      steps: [{ name: "x", agent: "reader", subagent: "Unknown" }],
    })).rejects.toThrow(/invalid subagent/);
  });

  it("workflow_create throws on step name containing newline (YAML injection defense)", async () => {
    await expect(env.handlers.handle("workflow_create", {
      name: "injection-flow",
      description: "Test",
      steps: [{ name: "step1\ninjected: true", agent: "reader" }],
    })).rejects.toThrow(/must match \^\[a-z0-9\]/);
  });

  it("workflow_create throws on gateCommand containing newline", async () => {
    await expect(env.handlers.handle("workflow_create", {
      name: "injection-gatecmd",
      description: "Test",
      steps: [{
        name: "check",
        agent: "tester",
        gate: "custom-command",
        gateCommand: "true\nname: pwned",
      }],
    })).rejects.toThrow(/gateCommand must not contain line breaks/);
  });

  it("throws for unknown tool", async () => {
    await expect(env.handlers.handle("nonexistent", {}))
      .rejects.toThrow("Unknown tool: nonexistent");
  });

  describe("profile_get / profile_set / profile_clear", () => {
    function writeMinimalConfig(): void {
      const yaml = [
        "active_profile: senior_fast",
        "",
        "profiles:",
        "  onboarding:",
        "    language: ru",
        "    tone: friendly",
        "  senior_fast:",
        "    language: ru",
        "    tone: terse",
        "    output: code_first",
        "",
      ].join("\n");
      writeFileSync(join(env.context.vaultPath, "communication.yaml"), yaml, "utf-8");
    }

    it("profile_get returns configured: false when communication.yaml missing", async () => {
      const result = await env.handlers.handle("profile_get", {}) as {
        configured: boolean; active: unknown; available: unknown[];
      };
      expect(result.configured).toBe(false);
      expect(result.active).toBeNull();
      expect(result.available).toEqual([]);
    });

    it("profile_get returns full snapshot when configured (no state file)", async () => {
      writeMinimalConfig();
      const result = await env.handlers.handle("profile_get", {}) as {
        configured: boolean;
        active: string | null;
        default: string;
        effective: string;
        available: string[];
        config: { language: string; tone: string };
      };
      expect(result.configured).toBe(true);
      expect(result.active).toBeNull();
      expect(result.default).toBe("senior_fast");
      expect(result.effective).toBe("senior_fast");
      expect(result.available).toEqual(["onboarding", "senior_fast"]);
      expect(result.config.tone).toBe("terse");
    });

    it("profile_set persists name and profile_get reflects it", async () => {
      writeMinimalConfig();
      const setResult = await env.handlers.handle("profile_set", { name: "onboarding" }) as {
        ok: boolean; active: string;
      };
      expect(setResult.ok).toBe(true);
      expect(setResult.active).toBe("onboarding");

      const getResult = await env.handlers.handle("profile_get", {}) as {
        active: string; effective: string; config: { tone: string };
      };
      expect(getResult.active).toBe("onboarding");
      expect(getResult.effective).toBe("onboarding");
      expect(getResult.config.tone).toBe("friendly");
    });

    it("profile_set throws on unknown name (with available list in error)", async () => {
      writeMinimalConfig();
      await expect(env.handlers.handle("profile_set", { name: "nonexistent" }))
        .rejects.toThrow(/unknown profile 'nonexistent'.*available: onboarding, senior_fast/);
    });

    it("profile_set throws when communication.yaml missing", async () => {
      await expect(env.handlers.handle("profile_set", { name: "onboarding" }))
        .rejects.toThrow(/communication\.yaml not found/);
    });

    it("profile_set throws on missing name parameter", async () => {
      writeMinimalConfig();
      await expect(env.handlers.handle("profile_set", {}))
        .rejects.toThrow(/Missing required parameter: name/);
    });

    it("profile_clear removes state file (subsequent profile_get returns default)", async () => {
      writeMinimalConfig();
      await env.handlers.handle("profile_set", { name: "onboarding" });

      const clearResult = await env.handlers.handle("profile_clear", {}) as { ok: boolean };
      expect(clearResult.ok).toBe(true);

      const getResult = await env.handlers.handle("profile_get", {}) as {
        active: string | null; effective: string;
      };
      expect(getResult.active).toBeNull();
      expect(getResult.effective).toBe("senior_fast");
    });

    it("profile_clear is no-op when state file missing (no throw)", async () => {
      writeMinimalConfig();
      const result = await env.handlers.handle("profile_clear", {}) as { ok: boolean };
      expect(result.ok).toBe(true);
    });

    it("profile_set rejects __proto__ (defense-in-depth via communication.yaml schema)", async () => {
      writeMinimalConfig();
      // setActiveProfile regex is /^[\w][\w_-]*$/ which DOES match __proto__,
      // but profile_set's hasOwnProperty check rejects it because __proto__
      // is not in the (Object.create(null)-based) profiles map.
      await expect(env.handlers.handle("profile_set", { name: "__proto__" }))
        .rejects.toThrow(/unknown profile '__proto__'/);
    });
  });
});

describe("McpServer.handleLine", () => {
  let env: ReturnType<typeof createTestEnv>;
  let server: McpServer;
  let originalEngramSocket: string | undefined;

  beforeEach(() => {
    originalEngramSocket = process.env["ENGRAM_SOCKET_PATH"];
    process.env["ENGRAM_SOCKET_PATH"] = "/tmp/no-such-engram-socket-isolated-test";
    env = createTestEnv();
    server = new McpServer(env.handlers);
  });

  afterEach(() => {
    rmSync(env.projectRoot, { recursive: true, force: true });
    if (originalEngramSocket === undefined) {
      delete process.env["ENGRAM_SOCKET_PATH"];
    } else {
      process.env["ENGRAM_SOCKET_PATH"] = originalEngramSocket;
    }
  });

  it("returns parse error for invalid JSON", async () => {
    const response = await server.handleLine("not json");
    expect(response!.error!.code).toBe(-32700);
  });

  it("returns error for non-2.0 jsonrpc", async () => {
    const response = await server.handleLine(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }));
    expect(response!.error!.code).toBe(-32600);
  });

  it("handles initialize", async () => {
    const response = await server.handleLine(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize", params: {},
    }));
    const result = response!.result as { serverInfo: { name: string } };
    expect(result.serverInfo.name).toBe("dev-workflow");
  });

  it("handles ping", async () => {
    const response = await server.handleLine(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "ping",
    }));
    expect(response!.result).toEqual({});
  });

  it("handles tools/list", async () => {
    const response = await server.handleLine(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/list",
    }));
    const result = response!.result as { tools: Array<unknown> };
    expect(result.tools).toHaveLength(23);
  });

  it("handles tools/call", async () => {
    const response = await server.handleLine(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "vault_read", arguments: { section: "stack" } },
    }));
    const result = response!.result as { content: Array<{ text: string }> };
    expect(result.content[0]!.text).toContain("Stack");
  });

  it("returns method not found for unknown method", async () => {
    const response = await server.handleLine(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "unknown/method",
    }));
    expect(response!.error!.code).toBe(-32601);
  });

  it("returns null for notifications/initialized", async () => {
    const response = await server.handleLine(JSON.stringify({
      jsonrpc: "2.0", method: "notifications/initialized",
    }));
    expect(response).toBeNull();
  });
});

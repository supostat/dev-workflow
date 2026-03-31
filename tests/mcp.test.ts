import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  const handlers = new ToolHandlers(
    vaultReader, writer, context, registry, contextBuilder, taskManager,
  );

  return { projectRoot, context, handlers, taskManager, agentsDir };
}

describe("getToolDefinitions", () => {
  it("returns 12 tool definitions", () => {
    const tools = getToolDefinitions();
    expect(tools).toHaveLength(12);
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

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    rmSync(env.projectRoot, { recursive: true, force: true });
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

  it("vault_knowledge appends to knowledge.md", async () => {
    await env.handlers.handle("vault_knowledge", {
      section: "Gotchas",
      content: "- Watch out for ESM imports",
    });

    const reader = new VaultReader(env.context);
    const knowledge = reader.readKnowledge();
    expect(knowledge).toContain("Watch out for ESM imports");
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

  it("throws for unknown tool", async () => {
    await expect(env.handlers.handle("nonexistent", {}))
      .rejects.toThrow("Unknown tool: nonexistent");
  });
});

describe("McpServer.handleLine", () => {
  let env: ReturnType<typeof createTestEnv>;
  let server: McpServer;

  beforeEach(() => {
    env = createTestEnv();
    server = new McpServer(env.handlers);
  });

  afterEach(() => {
    rmSync(env.projectRoot, { recursive: true, force: true });
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
    expect(result.tools).toHaveLength(12);
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

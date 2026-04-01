export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "vault_read",
      description: "Read a vault section (stack, conventions, knowledge, gameplan)",
      inputSchema: {
        type: "object",
        properties: {
          section: { type: "string", enum: ["stack", "conventions", "knowledge", "gameplan"] },
        },
        required: ["section"],
      },
    },
    {
      name: "vault_search",
      description: "Search vault files by text query",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for" },
        },
        required: ["query"],
      },
    },
    {
      name: "vault_record",
      description: "Create a vault record (ADR, bug, or debt)",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["adr", "bug", "debt"] },
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["type", "title", "content"],
      },
    },
    {
      name: "vault_knowledge",
      description: "Append content to a knowledge.md section",
      inputSchema: {
        type: "object",
        properties: {
          section: { type: "string", description: "Section name in knowledge.md" },
          content: { type: "string" },
        },
        required: ["section", "content"],
      },
    },
    {
      name: "vault_status",
      description: "Get full vault status: section completeness, tasks summary, active workflow, intelligence stats",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "workflow_status",
      description: "Get status of a workflow run",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string", description: "Optional run ID, defaults to current" },
        },
      },
    },
    {
      name: "intelligence_query",
      description: "Query intelligence graph for relevant patterns scored by recency, frequency, and context match",
      inputSchema: {
        type: "object",
        properties: {
          branch: { type: "string", description: "Current branch for context scoring" },
          task: { type: "string", description: "Task description for context scoring" },
          limit: { type: "number", description: "Max results (default 15)" },
        },
      },
    },
    {
      name: "task_start",
      description: "Start a task: set status to in-progress and link to a git branch",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "task_create",
      description: "Create a new task",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title"],
      },
    },
    {
      name: "task_list",
      description: "List tasks with optional status filter",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "in-progress", "review", "done", "blocked"] },
        },
      },
    },
    {
      name: "task_update",
      description: "Update a task's status or description",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["pending", "in-progress", "review", "done", "blocked"] },
          description: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "agent_list",
      description: "List available agents with their capabilities",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "agent_run",
      description: "Prepare an agent with vault context and return its prompt",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent name (reader, planner, coder, reviewer, tester, committer)" },
          task: { type: "string", description: "Task description for the agent" },
        },
        required: ["agent", "task"],
      },
    },
  ];
}

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
      name: "vault_pattern",
      description: "Append a pattern bullet to a section in conventions.md (default 'Patterns'). Section must exist; duplicate bullets are silently skipped (no error). Content must be a single line (no newlines). Dedup is case-sensitive and whitespace-insensitive.",
      inputSchema: {
        type: "object",
        properties: {
          section: {
            type: "string",
            description: "Section name in conventions.md (default: 'Patterns')",
          },
          content: {
            type: "string",
            description: "Pattern bullet to append; typically starts with '- '",
          },
        },
        required: ["content"],
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
      name: "task_create_from_phase",
      description: "Parse ## Tasks from a phase file and create missing tasks",
      inputSchema: {
        type: "object",
        properties: {
          phaseFile: { type: "string", description: "Path to phase file, e.g. .dev-vault/phases/phase-3-core.md" },
        },
        required: ["phaseFile"],
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
    {
      name: "parse_engram_feedback",
      description: "Parse '## Engram Feedback' section from agent output. Returns per-memory judgments + fallback ids. Used by command-path workflow orchestrator to convert agent output into memory_judge calls.",
      inputSchema: {
        type: "object",
        properties: {
          output: { type: "string", description: "Full agent output text (may include ## Engram Feedback section)" },
          expectedMemoryIds: {
            type: "array",
            items: { type: "string" },
            description: "Memory IDs retrieved before the step (from memory_search). Judgments for unknown IDs are ignored; missing IDs end up in fallbackIds.",
          },
        },
        required: ["output", "expectedMemoryIds"],
      },
    },
    {
      name: "workflow_create",
      description: "Create a custom workflow YAML in .dev-vault/workflows/<name>.yaml. Vault-only — does NOT write to .claude/commands/ (session-start hook auto-generates shims on next session restart).",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Workflow name: lowercase kebab-case, must match ^[a-z0-9][a-z0-9_-]{0,63}$",
          },
          description: {
            type: "string",
            description: "1-sentence human-readable purpose",
          },
          match: {
            type: "array",
            items: { type: "string" },
            description: "Optional: glob patterns for auto-routing free-form input",
          },
          steps: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Step identifier (kebab-case)" },
                agent: { type: "string", description: "Agent name (reader, planner, coder, etc. — builtin or custom via .dev-vault/agents/)" },
                input: { type: "array", items: { type: "string" }, description: "Optional refs to prior step outputs, e.g. ['read.output']" },
                gate: { type: "string", enum: ["none", "user-approve", "tests-pass", "review-pass", "custom-command"], description: "Gate type (default: none)" },
                gateCommand: { type: "string", description: "Optional shell command for custom-command gate" },
                onFail: { type: "string", description: "Optional step.name to retry on gate failure" },
                maxAttempts: { type: "number", description: "Retry cap (default: 3)" },
                stepFile: { type: "string", description: "Optional explicit step prompt path (relative, inside .dev-vault/workflow-steps/ or templates/)" },
                subagent: { type: "string", enum: ["Explore", "Full", "bash"], description: "Optional subagent type override" },
                outputBlock: { type: "string", description: "Optional named block identifier (UPPER_SNAKE_CASE)" },
              },
              required: ["name", "agent"],
            },
          },
        },
        required: ["name", "description", "steps"],
      },
    },
    {
      name: "memory_search",
      description: "Search Engram memories with auto-decoration (step/branch/run/task tags from active pipeline). Direct mcp__engram__memory_search remains available as escape hatch for explicit project/tag control.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 5)" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Extra tags merged (deduped) with auto-tags",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "memory_store",
      description: "Store an Engram memory with auto-decoration. Engram splits content into context/action/result fields.",
      inputSchema: {
        type: "object",
        properties: {
          context: { type: "string", description: "Situation / what was being done" },
          action: { type: "string", description: "Approach / decision taken" },
          result: { type: "string", description: "Outcome / why it matters for future" },
          type: {
            type: "string",
            enum: ["pattern", "antipattern", "decision", "bugfix", "context"],
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Extra tags merged (deduped) with auto-tags",
          },
        },
        required: ["context", "action", "result", "type"],
      },
    },
    {
      name: "memory_judge",
      description: "Rate an Engram memory's usefulness (0.0-1.0). Feeds Q-learning router.",
      inputSchema: {
        type: "object",
        properties: {
          memory_id: { type: "string" },
          score: { type: "number", minimum: 0, maximum: 1 },
          explanation: { type: "string", description: "Brief judgment rationale" },
        },
        required: ["memory_id", "score"],
      },
    },
  ];
}

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
      name: "workflow_start",
      description: "Initiate a workflow run from the slash-orchestrator path. Resolves the workflow by name (custom YAML → templates → builtins), creates a run state file at <vault>/workflow-state/runs/run-<12hex>.json, and sets ENGRAM_TRACE_FILE + ENGRAM_RUN_ID env vars for engram trace correlation. Returns the generated runId (prefixed-hex format `run-<12hex>`) and the trace file path. Validation: workflowName must match /^[a-z0-9][a-z0-9_-]{0,63}$/ (E001); taskDescription non-empty after trim (E002); taskId, if provided, must match /^task-\\d{3,}$/ (E003); unknown workflow throws E004.",
      inputSchema: {
        type: "object",
        properties: {
          workflowName: {
            type: "string",
            pattern: "^[a-z0-9][a-z0-9_-]{0,63}$",
            description: "Workflow name (lowercase kebab-case, 1-64 chars). Resolved against .dev-vault/workflows/, templates/workflows/, and builtins.",
          },
          taskDescription: {
            type: "string",
            description: "Free-form task description threaded into every step prompt",
          },
          taskId: {
            type: "string",
            pattern: "^task-\\d{3,}$",
            description: "Optional. Link the run to a vault task (e.g. 'task-021')",
          },
        },
        required: ["workflowName", "taskDescription"],
      },
    },
    {
      name: "step_start",
      description: "Update run.currentStep at the start of a workflow step. Pairs with step_complete to give engram traces accurate step:<name> tags. Call before memory_search calls in Step X.0 of each step file. Run resolution priority: explicit runId → ENGRAM_RUN_ID env → throw E003. Validation: stepName must match /^[a-z0-9][a-z0-9_-]{0,63}$/ (E001); runId, if provided, must match /^run-[a-f0-9]{12}$/ (E002); missing active run throws E003; runId not found in state throws E004.",
      inputSchema: {
        type: "object",
        properties: {
          stepName: {
            type: "string",
            pattern: "^[a-z0-9][a-z0-9_-]{0,63}$",
            description: "Pipeline step identifier (lowercase kebab-case, 1-64 chars, e.g. 'read', 'plan', 'code', 'review')",
          },
          runId: {
            type: "string",
            pattern: "^run-[a-f0-9]{12}$",
            description: "Optional workflow run id (prefixed-hex format). Falls back to ENGRAM_RUN_ID env when omitted.",
          },
        },
        required: ["stepName"],
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
    {
      name: "step_complete",
      description: "Finalize a pipeline step: parse the agent's `## Engram Feedback` block, apply each judgment to engram (silent fail-safe, capped at 20/call), and emit antipattern observability (ids retrieved + score distribution buckets). NO blanket fallback — memories without explicit feedback land in `fallbackIds` for orchestrator-level handling.",
      inputSchema: {
        type: "object",
        properties: {
          stepName: {
            type: "string",
            description: "Pipeline step identifier (e.g. 'plan', 'code', 'review')",
          },
          runId: {
            type: "string",
            description: "Optional workflow run id for telemetry correlation",
          },
          beforeSearchMemoryIds: {
            type: "array",
            description: "Memories retrieved before the step (from memory_search). Each item carries its engram memory_type for antipattern observability.",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
                  description: "Engram memory UUID",
                },
                memoryType: {
                  type: "string",
                  description: "Engram memory_type (pattern, antipattern, decision, bugfix, context)",
                },
              },
              required: ["id", "memoryType"],
            },
          },
          output: {
            type: "string",
            description: "Full subagent output, parsed server-side via extractEngramFeedbackSection — do not pre-process",
          },
        },
        required: ["stepName", "beforeSearchMemoryIds", "output"],
      },
    },
    {
      name: "profile_get",
      description: "Read communication profile state: active (from .profile-state), default (from communication.yaml), available list, and effective profile config",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "profile_set",
      description: "Activate a communication profile by name. Validates name exists in communication.yaml; persists in gitignored .dev-vault/.profile-state",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Profile name (must exist in communication.yaml profiles map)" },
        },
        required: ["name"],
      },
    },
    {
      name: "profile_clear",
      description: "Reset active profile state by deleting .dev-vault/.profile-state. After clear, getActive falls back to communication.yaml's active_profile field. No-op if state file already missing",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];
}

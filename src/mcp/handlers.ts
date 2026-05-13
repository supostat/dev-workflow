import type { VaultReader } from "../lib/reader.js";
import type { VaultWriter } from "../lib/writer.js";
import type { ProjectContext } from "../lib/types.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentContextBuilder } from "../agents/context-builder.js";
import type { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import type { WorkflowCreateInput } from "./workflow-create.js";
import { requireString, optionalString } from "./handlers/helpers.js";
import * as vault from "./handlers/vault.js";
import * as task from "./handlers/task.js";
import * as agent from "./handlers/agent.js";
import * as workflow from "./handlers/workflow.js";
import * as memory from "./handlers/memory.js";
import * as profile from "./handlers/profile.js";

/**
 * Thin MCP-tool dispatcher. Holds the shared dependency graph (vault
 * reader/writer, agent registry, context builder, task manager/tracker,
 * project context) and forwards each `tools/call` to the appropriate
 * domain handler in `./handlers/*.ts`.
 *
 * The split (2026-05-11) replaced a 579-LOC monolithic class with this
 * ~140-LOC dispatcher + six domain files (vault / task / agent /
 * workflow / memory / profile) + shared helpers. Test surface unchanged
 * — `tests/mcp.test.ts` exercises this class via `McpServer.handleLine`
 * without touching the new internal layout.
 */
export class ToolHandlers {
  private readonly vaultReader: VaultReader;
  private readonly vaultWriter: VaultWriter;
  private readonly context: ProjectContext;
  private readonly agentRegistry: AgentRegistry;
  private readonly contextBuilder: AgentContextBuilder;
  private readonly taskManager: TaskManager;
  private readonly taskTracker: TaskTracker;

  constructor(
    vaultReader: VaultReader,
    vaultWriter: VaultWriter,
    context: ProjectContext,
    agentRegistry: AgentRegistry,
    contextBuilder: AgentContextBuilder,
    taskManager: TaskManager,
    taskTracker: TaskTracker,
  ) {
    this.vaultReader = vaultReader;
    this.vaultWriter = vaultWriter;
    this.context = context;
    this.agentRegistry = agentRegistry;
    this.contextBuilder = contextBuilder;
    this.taskManager = taskManager;
    this.taskTracker = taskTracker;
  }

  async handle(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      // ── vault ──
      case "vault_read":
        return vault.vaultRead(this.vaultReader, requireString(params, "section"));

      case "vault_search":
        return vault.vaultSearch(this.context.vaultPath, requireString(params, "query"));

      case "vault_record":
        return vault.vaultRecord(
          this.vaultWriter,
          this.context,
          requireString(params, "type"),
          requireString(params, "title"),
          requireString(params, "content"),
        );

      case "vault_knowledge":
        return vault.vaultKnowledge(
          this.vaultWriter,
          this.context,
          requireString(params, "section"),
          requireString(params, "content"),
        );

      case "vault_pattern":
        return vault.vaultPattern(
          this.vaultWriter,
          this.context,
          optionalString(params, "section"),
          requireString(params, "content"),
        );

      case "vault_status":
        return vault.vaultStatus(this.vaultReader, this.context, this.taskManager);

      case "intelligence_query":
        return vault.intelligenceQuery(
          this.context,
          optionalString(params, "branch"),
          optionalString(params, "task"),
          params["limit"] as number | undefined,
        );

      // ── task ──
      case "task_create":
        return task.taskCreate(
          this.taskManager,
          requireString(params, "title"),
          optionalString(params, "description"),
        );

      case "task_list":
        return task.taskList(this.taskManager, optionalString(params, "status"));

      case "task_update":
        return task.taskUpdate(
          this.taskManager,
          requireString(params, "id"),
          optionalString(params, "status"),
          optionalString(params, "description"),
        );

      case "task_start":
        return task.taskStart(
          this.taskManager,
          this.taskTracker,
          requireString(params, "id"),
        );

      case "task_create_from_phase":
        return task.taskCreateFromPhase(
          this.taskManager,
          this.context,
          requireString(params, "phaseFile"),
        );

      // ── agent ──
      case "agent_list":
        return agent.agentList(this.agentRegistry);

      case "agent_run":
        return agent.agentRun(
          this.agentRegistry,
          this.contextBuilder,
          requireString(params, "agent"),
          requireString(params, "task"),
        );

      // ── workflow ──
      case "workflow_status":
        return workflow.workflowStatus(this.context.vaultPath, optionalString(params, "runId"));

      case "workflow_create":
        return workflow.workflowCreate(this.context.vaultPath, params as unknown as WorkflowCreateInput);

      case "workflow_start":
        return workflow.workflowStart(
          this.context.vaultPath,
          params["workflowName"],
          params["taskDescription"],
          params["taskId"],
        );

      case "step_start":
        return workflow.stepStart(
          this.context.vaultPath,
          params["stepName"],
          params["runId"],
        );

      // ── memory (engram) ──
      case "memory_search":
        return memory.memorySearch(
          this.context,
          requireString(params, "query"),
          {
            limit: typeof params["limit"] === "number" ? params["limit"] : undefined,
            tags: Array.isArray(params["tags"]) ? params["tags"] as string[] : undefined,
          },
        );

      case "memory_store": {
        const fields = ["context", "action", "result", "type"] as const;
        const missing = fields.filter((f) => typeof params[f] !== "string" || params[f] === "");
        if (missing.length > 0) {
          throw new Error(
            `memory_store requires four non-empty string fields (context, action, result, type). ` +
            `Missing or empty: ${missing.join(", ")}. ` +
            `Each field stores a distinct aspect of the memory — call tools/list for the full schema with descriptions.`,
          );
        }
        return memory.memoryStore(
          this.context,
          params["context"] as string,
          params["action"] as string,
          params["result"] as string,
          params["type"] as string,
          { tags: Array.isArray(params["tags"]) ? params["tags"] as string[] : undefined },
        );
      }

      case "memory_judge":
        return memory.memoryJudge(
          this.context,
          requireString(params, "memory_id"),
          typeof params["score"] === "number" ? params["score"] : Number(params["score"]),
          optionalString(params, "explanation"),
        );

      case "parse_engram_feedback":
        return memory.parseEngramFeedback(requireString(params, "output"), params["expectedMemoryIds"]);

      case "step_complete": {
        const stepName = requireString(params, "stepName");
        if (typeof params["output"] !== "string") {
          throw new Error("step_complete: output must be a string");
        }
        const beforeSearchMemoryIds = memory.validateBeforeSearchMemoryIds(
          params["beforeSearchMemoryIds"],
        );
        return memory.stepComplete(
          this.context,
          stepName,
          beforeSearchMemoryIds,
          params["output"] as string,
        );
      }

      // ── profile ──
      case "profile_get":
        return profile.profileGet(this.context.vaultPath);

      case "profile_set":
        return profile.profileSet(this.context.vaultPath, requireString(params, "name"));

      case "profile_clear":
        return profile.profileClear(this.context.vaultPath);

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}

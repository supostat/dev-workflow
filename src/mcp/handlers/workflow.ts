import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolveWorkflow } from "../../cli/run.js";
import { WorkflowState } from "../../workflow/state.js";
import type { StepState, WorkflowRun } from "../../workflow/types.js";
import { createWorkflow, type WorkflowCreateInput } from "../workflow-create.js";

const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_PATTERN = /^task-\d{3,}$/;
/**
 * Step names from custom workflow YAML become object keys in
 * `steps: Record<string, StepState>`. Rejecting `__proto__`, `constructor`,
 * `prototype` (all start with `_` or uppercase) and any non-kebab-case name
 * prevents prototype pollution via crafted YAML — defense-in-depth at the
 * MCP boundary even though the loader could be hardened independently.
 */
const STEP_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function workflowStatus(vaultPath: string, runId?: string): unknown {
  const state = new WorkflowState(vaultPath);
  if (runId) {
    try {
      return state.load(runId);
    } catch {
      return { message: `Workflow run not found: ${runId}` };
    }
  }
  const current = state.loadCurrent();
  if (!current) {
    return { message: "No active workflow." };
  }
  return current;
}

export function workflowCreate(vaultPath: string, input: WorkflowCreateInput): { filepath: string } {
  return createWorkflow(input, vaultPath);
}

/**
 * Validate `workflow_start` input at the MCP boundary. Throws on first
 * failure with a stable error code (E001..E003) — callers map these to
 * JSON-RPC error responses.
 *
 * Defense-in-depth: every input field is validated before any state
 * mutation. `workflowName` regex matches the same pattern used by
 * `workflow_create` (vault YAML loader); `taskId` follows the
 * `tasks/task-NNN.md` filename convention.
 */
function validateWorkflowStartInput(
  workflowName: unknown,
  taskDescription: unknown,
  taskId: unknown,
): { workflowName: string; taskDescription: string; taskId: string | null } {
  if (typeof workflowName !== "string" || !WORKFLOW_NAME_PATTERN.test(workflowName)) {
    throw new Error(
      "E001: workflowName must match /^[a-z0-9][a-z0-9_-]{0,63}$/ " +
      "(lowercase kebab-case, 1-64 chars, starts with [a-z0-9])",
    );
  }
  if (typeof taskDescription !== "string" || taskDescription.trim().length === 0) {
    throw new Error("E002: taskDescription must be a non-empty string");
  }
  let normalizedTaskId: string | null = null;
  if (taskId !== undefined && taskId !== null) {
    if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) {
      throw new Error("E003: taskId, when provided, must match /^task-\\d{3,}$/");
    }
    normalizedTaskId = taskId;
  }
  return { workflowName, taskDescription, taskId: normalizedTaskId };
}

/**
 * Initiate a workflow run from the slash-orchestrator path. Builds the
 * `WorkflowRun` record, persists it to `<vault>/workflow-state/runs/`, and
 * sets the engram trace env vars so subsequent step calls (`step_complete`,
 * `memory_*` proxies) can correlate to this run.
 *
 * runId format: `run-<12hex>` derived from `crypto.randomUUID()` — the
 * `run-` prefix is required for `engram-stats.ts:52` and `state.ts:list()`
 * filters; the hex tail is concurrency-friendly (no date-seq race between
 * parallel orchestrator instances).
 *
 * **Generator divergence from {@link WorkflowEngine.generateRunId}**
 * (`src/workflow/engine.ts:431-437`): the engine path (programmatic
 * `dev-workflow run`) uses date-seq (`run-<YYYY-MM-DD>-<seq>`); the MCP
 * entry point (slash orchestrator) uses prefixed-hex. Two generators by
 * design — engine generator stays untouched.
 *
 * resolveWorkflow is imported from `src/cli/run.ts` directly: a grep audit
 * (`grep -rn "from.*mcp" src/cli/run.ts`) confirmed no MCP imports there,
 * so no circular dependency.
 *
 * **Concurrency limitation**: dev-workflow assumes one active workflow run
 * per Node.js process. ENGRAM_TRACE_FILE and ENGRAM_RUN_ID env vars are
 * process-global; concurrent workflow_start calls in the same process will
 * race on env-set. Mitigation: caller (slash orchestrator) serializes runs.
 * Multi-run support would require Map-keyed registry or per-request env
 * override (future Phase 3 task).
 *
 * **Defense-in-depth note**: step.name from custom workflow YAML is
 * validated here against STEP_NAME_PATTERN before being used as object key
 * in steps Record. This prevents prototype pollution via __proto__/
 * constructor/prototype step names regardless of upstream loader strictness.
 */
export function workflowStart(
  vaultPath: string,
  workflowName: unknown,
  taskDescription: unknown,
  taskId: unknown,
): { runId: string; traceFilePath: string } {
  const input = validateWorkflowStartInput(workflowName, taskDescription, taskId);

  let workflow;
  try {
    workflow = resolveWorkflow(input.workflowName, vaultPath);
  } catch {
    throw new Error(
      `E004: unknown workflow "${input.workflowName}" — not found in ` +
      ".dev-vault/workflows/, templates/workflows/, or builtins",
    );
  }

  const runId = "run-" + randomUUID().replace(/-/g, "").substring(0, 12);

  const steps: Record<string, StepState> = {};
  for (const step of workflow.steps) {
    if (!STEP_NAME_PATTERN.test(step.name)) {
      throw new Error(
        `E005: step name "${step.name}" must match /^[a-z0-9][a-z0-9_-]{0,63}$/ ` +
        `(workflow "${workflow.name}" contains invalid step name)`,
      );
    }
    steps[step.name] = {
      status: "pending",
      output: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      attempt: 0,
      engramMemoryId: null,
      error: null,
    };
  }

  const run: WorkflowRun = {
    id: runId,
    workflowName: workflow.name,
    taskId: input.taskId,
    taskDescription: input.taskDescription,
    currentStep: workflow.steps[0]!.name,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
    steps,
  };

  new WorkflowState(vaultPath).save(run);

  const traceFilePath = join(vaultPath, "workflow-state", "runs", `${runId}.engram-trace.jsonl`);
  if (!process.env["ENGRAM_TRACE_FILE"]) {
    process.env["ENGRAM_TRACE_FILE"] = traceFilePath;
  }
  if (!process.env["ENGRAM_RUN_ID"]) {
    process.env["ENGRAM_RUN_ID"] = runId;
  }

  return { runId, traceFilePath };
}

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkflow } from "../../workflow/resolver.js";
import { parseGameplanPhase } from "../../lib/gameplan-parser.js";
import { WorkflowState } from "../../workflow/state.js";
import type { StepState, WorkflowRun } from "../../workflow/types.js";
import { createWorkflow, type WorkflowCreateInput } from "../workflow-create.js";

const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_PATTERN = /^task-\d{3,}$/;
const RUN_ID_PATTERN = /^run-[a-f0-9]{12}$/;
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
 * List persisted workflow runs, newest first, optionally filtered by status.
 * Read-only — no state mutation. Backs the read-only `GET /api/workflow/runs`
 * web endpoint. `status`, when provided, must be one of the
 * {@link WorkflowStatus} values; an unrecognised value yields an empty list
 * rather than throwing (the caller validates the query param at the boundary,
 * this is defense-in-depth).
 */
export function workflowList(vaultPath: string, status?: string): WorkflowRun[] {
  const runs = new WorkflowState(vaultPath).list();
  if (status === undefined) return runs;
  return runs.filter((run) => run.status === status);
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
 * resolveWorkflow is imported from the `src/workflow/` domain layer
 * (`workflow/resolver.ts`) — an MCP handler depending on a domain module,
 * the expected direction of the dependency graph.
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

  // Snapshot the active gameplan phase at run-start (task-023, ADR
  // 2026-05-13). Direct `node:fs` read keeps the handler symmetric with
  // `WorkflowState(vaultPath)` — avoids constructing a full `ProjectContext`
  // just to instantiate `VaultReader` for a single-file read. Snapshot
  // semantics: subsequent edits to `gameplan.md` mid-run do NOT propagate;
  // the tag emitted by `buildAutoTags` reflects the value captured here.
  let phase: string | null = null;
  try {
    const gameplanPath = join(vaultPath, "gameplan.md");
    if (existsSync(gameplanPath)) {
      const content = readFileSync(gameplanPath, "utf-8");
      phase = parseGameplanPhase(content);
    }
  } catch {
    // Graceful fallback — gameplan unreadable (permissions, race) →
    // phase stays null; absence of a phase tag is acceptable, throwing
    // would abort an otherwise valid workflow_start call.
  }

  const run: WorkflowRun = {
    id: runId,
    workflowName: workflow.name,
    taskId: input.taskId,
    taskDescription: input.taskDescription,
    phase,
    currentStep: workflow.steps[0]!.name,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
    steps,
  };

  new WorkflowState(vaultPath).save(run);

  const traceFilePath = join(vaultPath, "workflow-state", "runs", `${runId}.engram-trace.jsonl`);
  // Repoint the engram trace env vars to THIS run, unconditionally. The MCP
  // server is a long-lived process serving sequential workflow runs and these
  // env vars are process-global. A conditional "set only if unset" left every
  // run after the first writing its trace events into the first run's
  // .engram-trace.jsonl — later runs showed "no trace" and a false 0%
  // search-hit-rate. Each workflow_start supersedes the previous run.
  process.env["ENGRAM_TRACE_FILE"] = traceFilePath;
  process.env["ENGRAM_RUN_ID"] = runId;

  return { runId, traceFilePath };
}

/**
 * Validate `step_start` input at the MCP boundary. Throws on first failure
 * with a stable error code (E001..E003) — callers map these to JSON-RPC
 * error responses.
 *
 * - `stepName` uses STEP_NAME_PATTERN (same kebab-case constraint that
 *   guards prototype pollution in `workflow_start` step keys).
 * - `runId`, when provided, must match the prefixed-hex format minted by
 *   `workflow_start` (`run-<12hex>`). The engine-path date-seq generator
 *   (`run-<YYYY-MM-DD>-<seq>`) is NOT accepted here — `step_start` is the
 *   slash-orchestrator's symmetric counterpart to `step_complete` and
 *   only the slash path produces prefixed-hex runIds.
 */
function validateStepStartInput(
  stepName: unknown,
  runId: unknown,
): { stepName: string; runId: string | null } {
  if (typeof stepName !== "string" || !STEP_NAME_PATTERN.test(stepName)) {
    throw new Error(
      "E001: stepName must match /^[a-z0-9][a-z0-9_-]{0,63}$/ " +
      "(lowercase kebab-case, 1-64 chars, starts with [a-z0-9])",
    );
  }
  let normalizedRunId: string | null = null;
  if (runId !== undefined && runId !== null) {
    if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
      throw new Error("E002: runId, when provided, must match /^run-[a-f0-9]{12}$/");
    }
    normalizedRunId = runId;
  }
  return { stepName, runId: normalizedRunId };
}

/**
 * Update `run.currentStep` at the start of a workflow step. Symmetric pair
 * with `step_complete` — together they bracket every pipeline step so
 * engram traces carry an accurate `step:<name>` auto-tag for memories
 * stored/searched mid-step.
 *
 * Run resolution priority:
 * 1. explicit `runId` parameter (orchestrator already knows the run)
 * 2. `process.env.ENGRAM_RUN_ID` (set by `workflow_start`)
 * 3. throw E003 — no active run, orchestrator must call `workflow_start` first
 *
 * Fail-loud on missing run (E004): `state.load` throws "Workflow run not
 * found" when the file is absent. We surface this as E004 with the runId
 * in the message instead of silent fail-safe — an orchestrator calling
 * `step_start` against a stale/wrong runId would otherwise emit memories
 * tagged with a step name that no run record will ever know about.
 *
 * Step state mutation (mirrors the CLI engine path):
 * - On first entry to a `pending` step → set `status = "running"`,
 *   `startedAt = now`. `attempt` stays at its initial 0 (engine.ts
 *   convention: attempt counts re-entries, first try is 0).
 * - On re-entry after a `completed` / `failed` / `skipped` state →
 *   `attempt += 1`, `startedAt` is reset to now.
 * - On a redundant call while already `running` (orchestrator double-fired
 *   step_start) → idempotent no-op for the step state, only `currentStep`
 *   is updated.
 * This makes step state machine-verifiable for `dev-workflow workflow
 * cleanup` (which classifies stale runs by examining every step's status)
 * and for the dashboard Workflow page on conversational runs.
 */
export function stepStart(
  vaultPath: string,
  stepName: unknown,
  runId: unknown,
): { ok: true } {
  const input = validateStepStartInput(stepName, runId);

  const resolvedRunId = input.runId ?? process.env["ENGRAM_RUN_ID"];
  if (!resolvedRunId) {
    throw new Error(
      "E003: no active run — call workflow_start first or pass runId explicitly",
    );
  }

  const state = new WorkflowState(vaultPath);
  let run: WorkflowRun;
  try {
    run = state.load(resolvedRunId);
  } catch {
    throw new Error(`E004: run not in state: ${resolvedRunId}`);
  }

  run.currentStep = input.stepName;
  const stepState = run.steps[input.stepName];
  if (stepState !== undefined && stepState.status !== "running") {
    if (
      stepState.status === "completed" ||
      stepState.status === "failed" ||
      stepState.status === "skipped"
    ) {
      stepState.attempt = stepState.attempt + 1;
      stepState.completedAt = null;
      stepState.durationMs = null;
      stepState.error = null;
    }
    stepState.status = "running";
    stepState.startedAt = new Date().toISOString();
  }
  state.save(run);

  // Propagate step name to engram trace events via env. Subagent
  // subprocesses inherit ENGRAM_STEP and so emit trace events
  // self-tagged with the current step, even though search-path tags
  // no longer carry step: (asymmetric tag injection, ADR 2026-05-14).
  process.env["ENGRAM_STEP"] = input.stepName;

  return { ok: true };
}

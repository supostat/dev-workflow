export type GateType =
  | "none"
  | "user-approve"
  | "tests-pass"
  | "review-pass"
  | "custom-command";

export type SubagentType = "Explore" | "Full" | "bash";

export interface StepDefinition {
  name: string;
  agent: string;
  input: string[];
  gate: GateType;
  gateCommand?: string;
  /**
   * Step name to redirect to when the gate fails.
   *
   * Re-entry routing must respect agent capability:
   * - Detail-level fixes route to Full agents (Write/Edit) — e.g. review→code, plan-review→plan-fix.
   *   Full agents support FIX/REVISION mode with surgical Edits over saved artifacts.
   * - Architecture-level changes route back to the originating Explore agent — e.g. plan-review→plan
   *   when the verdict requires re-planning. Explore agents have no Edit tool, so they re-emit
   *   the full output block from scratch.
   *
   * Engine reads `Next:` directive from agent output to override this default at runtime,
   * enabling conditional routing (architecture vs detail) per ADR
   * `2026-05-05-revision-through-planner-anti-pattern...md`.
   *
   * If the resolved target step does not exist, engine gracefully fails the run (status=failed,
   * stderr log, state saved) — no uncaught exception. If the runtime `Next:` directive points to
   * a non-whitelisted target (`isAllowedNextTarget`: coder + name ends with `-fix`), engine logs to
   * stderr and falls back to the static onFail target.
   *
   * Loader emits advisory warnings for suspicious YAML-declared routings (Full→Explore, onFail
   * cycles, self-loops). The attempt counter on a re-entered step is NOT reset — total budget
   * across the cycle is global, capped by maxAttempts.
   */
  onFail: string | null;
  maxAttempts: number;
  stepFile?: string;
  subagent?: SubagentType;
  outputBlock?: string;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  match: string[];
  steps: StepDefinition[];
}

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type WorkflowStatus = "running" | "completed" | "failed" | "paused" | "aborted";

export interface StepState {
  status: StepStatus;
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempt: number;
  engramMemoryId: string | null;
  /**
   * Set when a gate-checker throws an exception (e.g. ENOENT, command missing,
   * allowlist rejection in CliGateChecker.checkCustomCommand). When non-null,
   * step.status is "failed" and run.status is "failed" — the engine persists
   * state and exits the loop cleanly instead of letting the exception propagate.
   *
   * Always serialized: explicit `null` rather than missing field. Mirrors
   * `output: string | null` convention — predictable JSON shape across all
   * StepState instances, simpler reload semantics, no conditional access at
   * call sites.
   */
  error: string | null;
}

export interface TelemetryCounters {
  search: number;
  store: number;
  judge: number;
  vaultRecord: number;
  skipped: number;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  taskId: string | null;
  taskDescription: string;
  /**
   * Snapshot of the active gameplan phase at run-start (task-023, ADR
   * 2026-05-13). Populated by `workflowStart` via {@link parseGameplanPhase}
   * over `<vault>/gameplan.md`. Snapshot semantics: a mid-run edit to
   * `gameplan.md` does NOT propagate — the phase tag emitted by
   * `buildAutoTags` reflects the value captured at run-start. `null` when
   * gameplan is absent, missing the phase marker, or fails validation.
   */
  phase: string | null;
  currentStep: string;
  startedAt: string;
  completedAt: string | null;
  status: WorkflowStatus;
  steps: Record<string, StepState>;
  telemetry?: TelemetryCounters;
  /**
   * Free-form reason set when status transitions to `"aborted"`. Currently
   * only written by `dev-workflow workflow cleanup` (which marks
   * orchestrator-stranded runs that never reached a terminal state).
   * Optional — absent for runs that completed/failed normally.
   */
  abortReason?: string;
}

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
export type WorkflowStatus = "running" | "completed" | "failed" | "paused";

export interface StepState {
  status: StepStatus;
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempt: number;
  engramMemoryId: string | null;
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
  currentStep: string;
  startedAt: string;
  completedAt: string | null;
  status: WorkflowStatus;
  steps: Record<string, StepState>;
  telemetry?: TelemetryCounters;
}

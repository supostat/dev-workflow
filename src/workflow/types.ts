export type GateType =
  | "none"
  | "user-approve"
  | "tests-pass"
  | "review-pass";

export interface StepDefinition {
  name: string;
  agent: string;
  input: string[];
  gate: GateType;
  onFail: string | null;
  maxAttempts: number;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
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
}

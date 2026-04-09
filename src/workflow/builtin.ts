import type { WorkflowDefinition, StepDefinition } from "./types.js";

function step(
  name: string,
  agent: string,
  options: Partial<Pick<StepDefinition, "input" | "gate" | "gateCommand" | "onFail" | "maxAttempts">> = {},
): StepDefinition {
  return {
    name,
    agent,
    input: options.input ?? [],
    gate: options.gate ?? "none",
    gateCommand: options.gateCommand,
    onFail: options.onFail ?? null,
    maxAttempts: options.maxAttempts ?? 3,
  };
}

const DEV: WorkflowDefinition = {
  name: "dev",
  description: "Full development workflow: read, plan, code, review, test, commit",
  match: [],
  steps: [
    step("read", "reader"),
    step("plan", "planner", {
      input: ["read.output"],
      gate: "user-approve",
    }),
    step("code", "coder", {
      input: ["read.output", "plan.output"],
    }),
    step("review", "reviewer", {
      input: ["code.output"],
      gate: "review-pass",
      onFail: "code",
    }),
    step("test", "tester", {
      input: ["code.output"],
      gate: "tests-pass",
      onFail: "code",
    }),
    step("commit", "committer", {
      input: ["plan.output", "code.output"],
    }),
  ],
};

const HOTFIX: WorkflowDefinition = {
  name: "hotfix",
  description: "Quick fix workflow: read, code, test, commit",
  match: [],
  steps: [
    step("read", "reader"),
    step("code", "coder", {
      input: ["read.output"],
    }),
    step("test", "tester", {
      input: ["code.output"],
      gate: "tests-pass",
      onFail: "code",
    }),
    step("commit", "committer", {
      input: ["code.output"],
    }),
  ],
};

const REVIEW: WorkflowDefinition = {
  name: "review",
  description: "Code review only",
  match: [],
  steps: [
    step("read", "reader"),
    step("review", "reviewer", {
      input: ["read.output"],
    }),
  ],
};

const TEST: WorkflowDefinition = {
  name: "test",
  description: "Run tests only",
  match: [],
  steps: [
    step("read", "reader"),
    step("test", "tester", {
      input: ["read.output"],
      gate: "tests-pass",
    }),
  ],
};

const INTAKE: WorkflowDefinition = {
  name: "intake",
  description: "Classify free-form input and recommend a workflow",
  match: [],
  steps: [
    step("classify", "intake", { gate: "user-approve" }),
  ],
};

const BUILTIN_WORKFLOWS: ReadonlyMap<string, WorkflowDefinition> = new Map([
  ["dev", DEV],
  ["hotfix", HOTFIX],
  ["review", REVIEW],
  ["test", TEST],
  ["intake", INTAKE],
]);

export function getBuiltinWorkflows(): WorkflowDefinition[] {
  return [...BUILTIN_WORKFLOWS.values()];
}

export function getBuiltinWorkflow(name: string): WorkflowDefinition {
  const workflow = BUILTIN_WORKFLOWS.get(name);
  if (!workflow) {
    throw new Error(`Workflow not found: ${name}`);
  }
  return workflow;
}

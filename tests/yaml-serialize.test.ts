import { describe, it, expect } from "vitest";
import { serializeWorkflowYaml } from "../src/lib/yaml-serialize.js";
import { parseWorkflowYaml } from "../src/workflow/loader.js";
import type { WorkflowDefinition, StepDefinition } from "../src/workflow/types.js";

function buildStep(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    name: "read",
    agent: "reader",
    input: [],
    gate: "none",
    onFail: null,
    maxAttempts: 3,
    ...overrides,
  };
}

function buildWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test-flow",
    description: "Test workflow",
    match: [],
    steps: [buildStep()],
    ...overrides,
  };
}

describe("serializeWorkflowYaml", () => {
  it("serializes minimal workflow (name + description + 1 step)", () => {
    const yaml = serializeWorkflowYaml(buildWorkflow());

    expect(yaml).toContain("name: test-flow");
    expect(yaml).toContain("description: Test workflow");
    expect(yaml).toContain("steps:");
    expect(yaml).toContain("- name: read");
    expect(yaml).toContain("agent: reader");
    expect(yaml.endsWith("\n")).toBe(true);
  });

  it("serializes match field when non-empty", () => {
    const yaml = serializeWorkflowYaml(buildWorkflow({ match: ["src/**/*.ts", "*.sol"] }));

    expect(yaml).toContain("match: [src/**/*.ts, *.sol]");
  });

  it("omits match when empty array", () => {
    const yaml = serializeWorkflowYaml(buildWorkflow({ match: [] }));

    expect(yaml).not.toContain("match:");
  });

  it("omits step defaults (gate=none, onFail=null, maxAttempts=3, input=[])", () => {
    const yaml = serializeWorkflowYaml(buildWorkflow());

    expect(yaml).not.toContain("gate:");
    expect(yaml).not.toContain("onFail:");
    expect(yaml).not.toContain("maxAttempts:");
    expect(yaml).not.toContain("input:");
  });

  it("serializes non-default gate, onFail, maxAttempts", () => {
    const yaml = serializeWorkflowYaml(buildWorkflow({
      steps: [
        buildStep({ name: "plan", agent: "planner" }),
        buildStep({
          name: "review",
          agent: "reviewer",
          gate: "review-pass",
          onFail: "plan",
          maxAttempts: 5,
        }),
      ],
    }));

    expect(yaml).toContain("gate: review-pass");
    expect(yaml).toContain("onFail: plan");
    expect(yaml).toContain("maxAttempts: 5");
  });

  it("serializes optional fields (stepFile, subagent, outputBlock)", () => {
    const yaml = serializeWorkflowYaml(buildWorkflow({
      steps: [
        buildStep({
          name: "audit",
          agent: "auditor",
          stepFile: ".dev-vault/workflow-steps/audit.md",
          subagent: "Explore",
          outputBlock: "AUDIT_REPORT",
        }),
      ],
    }));

    expect(yaml).toContain("stepFile: .dev-vault/workflow-steps/audit.md");
    expect(yaml).toContain("subagent: Explore");
    expect(yaml).toContain("outputBlock: AUDIT_REPORT");
  });

  it("serializes input as JSON-style array [a.output, b.output]", () => {
    const yaml = serializeWorkflowYaml(buildWorkflow({
      steps: [
        buildStep({ name: "read", agent: "reader" }),
        buildStep({ name: "plan", agent: "planner", input: ["read.output"] }),
        buildStep({
          name: "code",
          agent: "coder",
          input: ["read.output", "plan.output"],
        }),
      ],
    }));

    expect(yaml).toContain("input: [read.output]");
    expect(yaml).toContain("input: [read.output, plan.output]");
  });

  it("serializes custom-command gate with gateCommand", () => {
    const yaml = serializeWorkflowYaml(buildWorkflow({
      steps: [
        buildStep({
          name: "lint",
          agent: "tester",
          gate: "custom-command",
          gateCommand: "npm run lint",
        }),
      ],
    }));

    expect(yaml).toContain("gate: custom-command");
    expect(yaml).toContain("gateCommand: npm run lint");
  });

  it("round-trips through parseWorkflowYaml preserving semantics", () => {
    const input = buildWorkflow({
      match: ["src/**/*.ts"],
      steps: [
        {
          name: "read",
          agent: "reader",
          input: [],
          gate: "none",
          onFail: null,
          maxAttempts: 3,
        },
        {
          name: "plan",
          agent: "planner",
          input: ["read.output"],
          gate: "user-approve",
          onFail: null,
          maxAttempts: 3,
        },
        {
          name: "code",
          agent: "coder",
          input: ["read.output", "plan.output"],
          gate: "none",
          onFail: null,
          maxAttempts: 3,
          subagent: "Full",
          outputBlock: "CODE_DONE",
        },
      ],
    });

    const serialized = serializeWorkflowYaml(input);
    const parsed = parseWorkflowYaml(serialized);

    expect(parsed).toEqual(input);
  });
});

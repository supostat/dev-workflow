import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StepDefinition, WorkflowDefinition } from "../src/workflow/types.js";
import { parseWorkflowYaml } from "../src/workflow/loader.js";
import { getBuiltinWorkflow, getBuiltinWorkflows } from "../src/workflow/builtin.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(testDir, "..", "templates", "workflows");

const WORKFLOW_NAMES = ["dev", "hotfix", "review", "test", "intake"] as const;

function loadYaml(name: string) {
  return parseWorkflowYaml(readFileSync(join(WORKFLOWS_DIR, `${name}.yaml`), "utf-8"));
}

function findStep(workflow: WorkflowDefinition, stepName: string): StepDefinition | undefined {
  return workflow.steps.find((step) => step.name === stepName);
}

describe("builtin workflow parity", () => {
  for (const name of WORKFLOW_NAMES) {
    it(`${name}.yaml matches getBuiltinWorkflow("${name}")`, () => {
      expect(loadYaml(name)).toEqual(getBuiltinWorkflow(name));
    });
  }

  it("getBuiltinWorkflows returns exactly the 5 builtin workflows", () => {
    const workflows = getBuiltinWorkflows();
    expect(workflows).toHaveLength(WORKFLOW_NAMES.length);
    expect(workflows.map((workflow) => workflow.name).sort()).toEqual([...WORKFLOW_NAMES].sort());
  });

  it("preserves description across YAML parse for all workflows", () => {
    for (const name of WORKFLOW_NAMES) {
      expect(loadYaml(name).description).toBe(getBuiltinWorkflow(name).description);
    }
  });

  it("preserves gate types across YAML parse", () => {
    const dev = loadYaml("dev");
    expect(findStep(dev, "plan")?.gate).toBe("user-approve");
    expect(findStep(dev, "review")?.gate).toBe("review-pass");
    expect(findStep(dev, "test")?.gate).toBe("tests-pass");
    expect(findStep(dev, "read")?.gate).toBe("none");
  });

  it("preserves onFail values across YAML parse", () => {
    const dev = loadYaml("dev");
    expect(findStep(dev, "review")?.onFail).toBe("code");
    expect(findStep(dev, "test")?.onFail).toBe("code");
    expect(findStep(dev, "read")?.onFail).toBeNull();
    expect(findStep(dev, "plan")?.onFail).toBeNull();
  });

  it("preserves input arrays across YAML parse", () => {
    const dev = loadYaml("dev");
    expect(findStep(dev, "code")?.input).toEqual(["read.output", "plan.output"]);
    expect(findStep(dev, "read")?.input).toEqual([]);
  });

  it("defaults maxAttempts to 3 when omitted in YAML", () => {
    const review = loadYaml("review");
    for (const step of review.steps) {
      expect(step.maxAttempts).toBe(3);
    }
  });

  it("defaults match to [] when omitted in YAML", () => {
    for (const name of WORKFLOW_NAMES) {
      expect(loadYaml(name).match).toEqual([]);
    }
  });

  it("leaves gateCommand undefined for all builtin steps", () => {
    for (const name of WORKFLOW_NAMES) {
      for (const step of loadYaml(name).steps) {
        expect(step.gateCommand).toBeUndefined();
      }
    }
  });

  it("leaves stepFile, subagent, and outputBlock undefined for all builtin steps", () => {
    for (const name of WORKFLOW_NAMES) {
      for (const step of loadYaml(name).steps) {
        expect(step.stepFile).toBeUndefined();
        expect(step.subagent).toBeUndefined();
        expect(step.outputBlock).toBeUndefined();
      }
    }
  });
});

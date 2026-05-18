import { describe, it, expect } from "vitest";
import { buildDryRunPreview, type DryRunPreview } from "../src/cli/dry-run.js";
import { getBuiltinWorkflow } from "../src/workflow/builtin.js";
import type { WorkflowDefinition } from "../src/workflow/types.js";

describe("buildDryRunPreview", () => {
  it("returns workflow name + description from the input WorkflowDefinition", () => {
    const dev = getBuiltinWorkflow("dev");
    const preview = buildDryRunPreview(dev, "implement feature X");
    expect(preview.workflow.name).toBe("dev");
    expect(preview.workflow.description).toBe(dev.description);
  });

  it("captures task description and optional taskId", () => {
    const dev = getBuiltinWorkflow("dev");
    const previewWithoutId = buildDryRunPreview(dev, "fix bug");
    expect(previewWithoutId.task.description).toBe("fix bug");
    expect(previewWithoutId.task.taskId).toBeNull();

    const previewWithId = buildDryRunPreview(dev, "fix bug", "task-042");
    expect(previewWithId.task.taskId).toBe("task-042");
  });

  it("stepCount matches workflow.steps.length", () => {
    const dev = getBuiltinWorkflow("dev");
    const preview = buildDryRunPreview(dev, "task");
    expect(preview.stepCount).toBe(dev.steps.length);
    expect(preview.steps).toHaveLength(dev.steps.length);
  });

  it("each step preview carries name, agent, gate, input, onFail, maxAttempts", () => {
    const dev = getBuiltinWorkflow("dev");
    const preview = buildDryRunPreview(dev, "task");
    for (let i = 0; i < dev.steps.length; i++) {
      const stepDef = dev.steps[i]!;
      const stepPrev = preview.steps[i]!;
      expect(stepPrev.index).toBe(i);
      expect(stepPrev.name).toBe(stepDef.name);
      expect(stepPrev.agent).toBe(stepDef.agent);
      expect(stepPrev.gate).toBe(stepDef.gate);
      expect(stepPrev.input).toEqual(stepDef.input);
      expect(stepPrev.onFail).toBe(stepDef.onFail);
      expect(stepPrev.maxAttempts).toBe(stepDef.maxAttempts);
    }
  });

  it("resolves subagent type per dispatcher rules", () => {
    const dev = getBuiltinWorkflow("dev");
    const preview = buildDryRunPreview(dev, "task");
    const byName = (n: string) => preview.steps.find((s) => s.name === n)!;
    // From dispatcher permission matrix:
    expect(byName("preflight").subagent).toBe("orchestrator");
    expect(byName("read").subagent).toBe("Explore");
    expect(byName("plan").subagent).toBe("Explore");
    expect(byName("plan-review").subagent).toBe("Explore");
    expect(byName("plan-fix").subagent).toBe("Full");
    expect(byName("code").subagent).toBe("Full");
    expect(byName("review").subagent).toBe("Explore");
    expect(byName("test").subagent).toBe("bash");
    expect(byName("verify").subagent).toBe("Explore");
    expect(byName("commit").subagent).toBe("Full");
    expect(byName("vault-updates").subagent).toBe("orchestrator");
  });

  it("subagentProvenance is non-empty for every step", () => {
    const dev = getBuiltinWorkflow("dev");
    const preview = buildDryRunPreview(dev, "task");
    for (const step of preview.steps) {
      expect(step.subagentProvenance.length).toBeGreaterThan(0);
    }
  });

  it("custom workflow with stepFile and outputBlock — fields propagate to preview", () => {
    const wf: WorkflowDefinition = {
      name: "custom",
      description: "test",
      match: [],
      steps: [
        {
          name: "custom-read",
          agent: "reader",
          input: [],
          gate: "none",
          gateCommand: undefined,
          onFail: null,
          maxAttempts: 3,
          stepFile: ".dev-vault/workflow-steps/custom.md",
          subagent: undefined,
          outputBlock: "CONTEXT_OUT",
        },
        {
          name: "gate-step",
          agent: "tester",
          input: ["custom-read.output"],
          gate: "custom-command",
          gateCommand: "npx eslint .",
          onFail: "custom-read",
          maxAttempts: 2,
          stepFile: undefined,
          subagent: undefined,
          outputBlock: undefined,
        },
      ],
    };
    const preview = buildDryRunPreview(wf, "test");
    expect(preview.steps[0]!.stepFile).toBe(".dev-vault/workflow-steps/custom.md");
    expect(preview.steps[0]!.outputBlock).toBe("CONTEXT_OUT");
    expect(preview.steps[1]!.gateCommand).toBe("npx eslint .");
    expect(preview.steps[1]!.maxAttempts).toBe(2);
    expect(preview.steps[1]!.onFail).toBe("custom-read");
    expect(preview.steps[1]!.input).toEqual(["custom-read.output"]);
  });

  it("preview is JSON-serializable (stable contract for --json mode)", () => {
    const dev = getBuiltinWorkflow("dev");
    const preview = buildDryRunPreview(dev, "task with \"quotes\"\nand newlines");
    const serialized = JSON.stringify(preview);
    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed = JSON.parse(serialized) as DryRunPreview;
    expect(parsed.workflow.name).toBe("dev");
    expect(parsed.steps.length).toBe(dev.steps.length);
  });
});

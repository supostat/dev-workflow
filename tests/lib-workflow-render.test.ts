import { describe, it, expect } from "vitest";
import {
  renderShow,
  renderGraphMermaid,
  renderGraphAscii,
  renderEffective,
} from "../src/lib/workflow-render.js";
import type { StepDefinition, WorkflowDefinition } from "../src/workflow/types.js";

function makeStep(overrides: Partial<StepDefinition> & Pick<StepDefinition, "name" | "agent">): StepDefinition {
  return {
    name: overrides.name,
    agent: overrides.agent,
    input: overrides.input ?? [],
    gate: overrides.gate ?? "none",
    gateCommand: overrides.gateCommand,
    onFail: overrides.onFail ?? null,
    maxAttempts: overrides.maxAttempts ?? 3,
    stepFile: overrides.stepFile,
    subagent: overrides.subagent,
    outputBlock: overrides.outputBlock,
  };
}

const SIMPLE_WORKFLOW: WorkflowDefinition = {
  name: "simple",
  description: "Simple two-step workflow",
  match: [],
  steps: [
    makeStep({ name: "read", agent: "reader" }),
    makeStep({ name: "code", agent: "coder", input: ["read.output"] }),
  ],
};

const DEV_WORKFLOW: WorkflowDefinition = {
  name: "devlike",
  description: "Dev-like fixture with plan-review and plan-fix",
  match: [],
  steps: [
    makeStep({ name: "preflight", agent: "preflight" }),
    makeStep({ name: "read", agent: "reader" }),
    makeStep({ name: "plan", agent: "planner", input: ["read.output"], gate: "user-approve" }),
    makeStep({
      name: "plan-review",
      agent: "plan-reviewer",
      input: ["read.output", "plan.output"],
      gate: "user-approve",
      onFail: "plan",
    }),
    makeStep({
      name: "plan-fix",
      agent: "coder",
      input: ["plan.output", "plan-review.output"],
      maxAttempts: 2,
    }),
    makeStep({ name: "code", agent: "coder", input: ["read.output", "plan.output"] }),
  ],
};

describe("renderShow", () => {
  it("renders workflow name and description", () => {
    const out = renderShow(DEV_WORKFLOW);
    expect(out).toContain("Workflow: devlike");
    expect(out).toContain("Description: Dev-like fixture with plan-review and plan-fix");
  });

  it("renders step count from steps[]", () => {
    const out = renderShow(DEV_WORKFLOW);
    expect(out).toContain("Steps (6):");
  });

  it("renders gate, onFail, and input details for plan-review step", () => {
    const out = renderShow(DEV_WORKFLOW);
    expect(out).toContain("[3] plan-review (Explore, plan-reviewer)");
    expect(out).toContain("Gate: user-approve");
    expect(out).toContain("OnFail: → plan");
    expect(out).toContain("Input: [read.output, plan.output]");
  });

  it("renders code step with input list", () => {
    const out = renderShow(SIMPLE_WORKFLOW);
    expect(out).toContain("[1] code (Full, coder)");
    expect(out).toContain("Input: [read.output]");
  });

  it("renders orchestrator subagent label", () => {
    const out = renderShow(DEV_WORKFLOW);
    expect(out).toContain("[0] preflight (orchestrator, preflight)");
    expect(out).toContain("Subagent: orchestrator-only, no subagent");
  });

  it("renders default subagent labels for reader (Explore) and coder (Full)", () => {
    const out = renderShow(SIMPLE_WORKFLOW);
    expect(out).toContain("[0] read (Explore, reader)");
    expect(out).toContain("[1] code (Full, coder)");
  });
});

describe("renderGraphMermaid", () => {
  it("starts with flowchart TD declaration", () => {
    const out = renderGraphMermaid(SIMPLE_WORKFLOW);
    expect(out.split("\n")[0]).toBe("flowchart TD");
  });

  it("renders sequential edge from read to code", () => {
    const out = renderGraphMermaid(SIMPLE_WORKFLOW);
    expect(out).toContain("    read --> code");
  });

  it("renders onFail edge as dotted with onFail label", () => {
    const out = renderGraphMermaid(DEV_WORKFLOW);
    expect(out).toContain("    plan-review -.->|onFail| plan");
  });

  it("includes Runtime Next comment when plan-reviewer + *-fix coder both present", () => {
    const out = renderGraphMermaid(DEV_WORKFLOW);
    expect(out).toContain("%% Runtime Next:");
  });

  it("omits Runtime Next comment when neither plan-reviewer nor *-fix coder present", () => {
    const out = renderGraphMermaid(SIMPLE_WORKFLOW);
    expect(out).not.toContain("Runtime Next");
  });
});

describe("renderGraphAscii", () => {
  it("renders steps with bracketed indices", () => {
    const out = renderGraphAscii(SIMPLE_WORKFLOW);
    expect(out).toContain("[0] read");
    expect(out).toContain("[1] code");
  });

  it("includes Legend section", () => {
    const out = renderGraphAscii(SIMPLE_WORKFLOW);
    expect(out).toContain("Legend:");
    expect(out).toContain("next     — sequential edge");
    expect(out).toContain("onFail   — failure redirect to named step");
  });

  it("renders gate and input inline for steps with non-default values", () => {
    const out = renderGraphAscii(DEV_WORKFLOW);
    expect(out).toContain("gate: user-approve");
    expect(out).toContain("input: [read.output]");
  });
});

describe("renderEffective", () => {
  it("renders Resolved step file with builtin-table source for plain agent", () => {
    const out = renderEffective(SIMPLE_WORKFLOW);
    expect(out).toContain("Resolved step file:");
    expect(out).toContain("(builtin-table)");
    expect(out).toContain("templates/claude/skills/workflow__dev/steps/read.md");
  });

  it("renders builtin-table (plan-fix special) source for plan-fix step", () => {
    const out = renderEffective(DEV_WORKFLOW);
    expect(out).toContain("(builtin-table (plan-fix special))");
    expect(out).toContain("templates/claude/skills/workflow__dev/steps/plan-fix.md");
  });

  it("renders explicit (stepFile) source when step has custom stepFile", () => {
    const customWorkflow: WorkflowDefinition = {
      name: "custom",
      description: "with custom stepFile",
      match: [],
      steps: [
        makeStep({
          name: "custom-step",
          agent: "reader",
          stepFile: ".dev-vault/workflow-steps/custom.md",
        }),
      ],
    };
    const out = renderEffective(customWorkflow);
    expect(out).toContain("(explicit (stepFile))");
    expect(out).toContain(".dev-vault/workflow-steps/custom.md");
  });

  it("renders Effective config JSON containing agent, gate, and input when non-empty", () => {
    const out = renderEffective(DEV_WORKFLOW);
    expect(out).toContain('"agent":"plan-reviewer"');
    expect(out).toContain('"gate":"user-approve"');
    expect(out).toContain('"input":["read.output","plan.output"]');
  });

  it("renders explicit subagent override with (explicit) provenance", () => {
    const customWorkflow: WorkflowDefinition = {
      name: "custom",
      description: "with explicit subagent override",
      match: [],
      steps: [
        makeStep({ name: "custom-bash", agent: "reader", subagent: "bash" }),
      ],
    };
    const out = renderEffective(customWorkflow);
    expect(out).toContain("Resolved subagent: bash");
    expect(out).toContain("(explicit)");
  });

  it("renders unknown subagent for unrecognized custom agent", () => {
    const customWorkflow: WorkflowDefinition = {
      name: "custom",
      description: "with unknown agent",
      match: [],
      steps: [
        makeStep({ name: "weird", agent: "custom-my-agent" }),
      ],
    };
    const out = renderEffective(customWorkflow);
    expect(out).toContain("Resolved subagent: unknown");
    expect(out).toContain("(custom agent — unresolved)");
  });

  it("resolves tester agent to bash subagent", () => {
    const testerWorkflow: WorkflowDefinition = {
      name: "tester-only",
      description: "tester agent",
      match: [],
      steps: [
        makeStep({ name: "test", agent: "tester" }),
      ],
    };
    const out = renderEffective(testerWorkflow);
    expect(out).toContain("Resolved subagent: bash");
    expect(out).toContain('by agent="tester"');
  });
});

describe("renderShow with bodies", () => {
  it("renders line-numbered body content for builtin reader step", () => {
    const out = renderShow(SIMPLE_WORKFLOW, { bodies: true });
    expect(out).toContain("Step file bodies:");
    expect(out).toContain("▼ [0] read");
    expect(out).toContain("templates/claude/skills/workflow__dev/steps/read.md");
    // Line numbers begin at 1 padded with at least one space
    expect(out).toMatch(/\n\s*1 /);
  });

  it("emits (file not readable) when stepFile points at a missing path", () => {
    const missingWorkflow: WorkflowDefinition = {
      name: "missing",
      description: "stepFile to non-existent file",
      match: [],
      steps: [
        makeStep({
          name: "ghost",
          agent: "reader",
          stepFile: ".dev-vault/workflow-steps/does-not-exist.md",
        }),
      ],
    };
    const out = renderShow(missingWorkflow, { bodies: true });
    expect(out).toContain("(file not readable)");
  });

  it("rejects stepFile with parent traversal segments", () => {
    const badWorkflow: WorkflowDefinition = {
      name: "bad",
      description: "path traversal attempt",
      match: [],
      steps: [
        makeStep({
          name: "evil",
          agent: "reader",
          stepFile: ".dev-vault/workflow-steps/../../../etc/passwd",
        }),
      ],
    };
    expect(() => renderShow(badWorkflow, { bodies: true })).toThrow(
      /rejected unsafe stepFile/,
    );
  });

  it("rejects absolute stepFile paths", () => {
    const badWorkflow: WorkflowDefinition = {
      name: "bad",
      description: "absolute path attempt",
      match: [],
      steps: [
        makeStep({
          name: "evil",
          agent: "reader",
          stepFile: "/etc/passwd",
        }),
      ],
    };
    expect(() => renderShow(badWorkflow, { bodies: true })).toThrow(
      /rejected unsafe stepFile/,
    );
  });

  it("rejects stepFile not under an allowed prefix", () => {
    const badWorkflow: WorkflowDefinition = {
      name: "bad",
      description: "outside allowed prefixes",
      match: [],
      steps: [
        makeStep({
          name: "evil",
          agent: "reader",
          stepFile: "src/lib/workflow-render.ts",
        }),
      ],
    };
    expect(() => renderShow(badWorkflow, { bodies: true })).toThrow(
      /rejected unsafe stepFile/,
    );
  });
});

describe("renderGraphMermaid asymmetric Next-comment", () => {
  it("omits Runtime Next when plan-reviewer present without *-fix coder", () => {
    const wf: WorkflowDefinition = {
      name: "plan-review-only",
      description: "plan-reviewer without plan-fix coder",
      match: [],
      steps: [
        makeStep({ name: "plan", agent: "planner" }),
        makeStep({ name: "plan-review", agent: "plan-reviewer", onFail: "plan" }),
        makeStep({ name: "code", agent: "coder" }),
      ],
    };
    const out = renderGraphMermaid(wf);
    expect(out).not.toContain("Runtime Next");
  });

  it("omits Runtime Next when *-fix coder present without plan-reviewer", () => {
    const wf: WorkflowDefinition = {
      name: "fix-coder-only",
      description: "plan-fix coder without plan-reviewer",
      match: [],
      steps: [
        makeStep({ name: "plan", agent: "planner" }),
        makeStep({ name: "plan-fix", agent: "coder" }),
        makeStep({ name: "code", agent: "coder" }),
      ],
    };
    const out = renderGraphMermaid(wf);
    expect(out).not.toContain("Runtime Next");
  });
});

describe("renderGraphMermaid safety", () => {
  it("throws on unsafe step name with metachars", () => {
    const wf: WorkflowDefinition = {
      name: "unsafe",
      description: "name with quotes",
      match: [],
      steps: [
        makeStep({ name: 'evil"step', agent: "reader" }),
        makeStep({ name: "next", agent: "coder" }),
      ],
    };
    expect(() => renderGraphMermaid(wf)).toThrow(/unsafe step name/);
  });

  it("throws on unsafe onFail target with newline", () => {
    const wf: WorkflowDefinition = {
      name: "unsafe-onfail",
      description: "onFail with metachars",
      match: [],
      steps: [
        makeStep({ name: "step", agent: "reader", onFail: "bad\nname" }),
      ],
    };
    expect(() => renderGraphMermaid(wf)).toThrow(/unsafe step name/);
  });
});

describe("renderGraphMermaid edge cases", () => {
  it("emits flowchart TD header for empty workflow without crashing", () => {
    const empty: WorkflowDefinition = {
      name: "empty",
      description: "no steps",
      match: [],
      steps: [],
    };
    const out = renderGraphMermaid(empty);
    expect(out).toBe("flowchart TD");
  });

  it("renders onFail edge to non-existent step without validation", () => {
    const wf: WorkflowDefinition = {
      name: "dangling",
      description: "onFail to non-existent step",
      match: [],
      steps: [
        makeStep({ name: "step", agent: "reader", onFail: "nonexistent" }),
      ],
    };
    const out = renderGraphMermaid(wf);
    expect(out).toContain("step -.->|onFail| nonexistent");
  });
});

describe("renderShow edge cases", () => {
  it("does not crash on empty workflow", () => {
    const empty: WorkflowDefinition = {
      name: "empty",
      description: "no steps",
      match: [],
      steps: [],
    };
    const out = renderShow(empty);
    expect(out).toContain("Workflow: empty");
    expect(out).toContain("Steps (0):");
  });
});

describe("renderGraphAscii edge cases", () => {
  it("does not crash on empty workflow and still emits Legend", () => {
    const empty: WorkflowDefinition = {
      name: "empty",
      description: "no steps",
      match: [],
      steps: [],
    };
    const out = renderGraphAscii(empty);
    expect(out).toContain("Legend:");
  });
});

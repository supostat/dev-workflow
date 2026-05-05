import { describe, it, expect } from "vitest";
import { extractVerdict, extractNextTarget, isAllowedNextTarget } from "../src/workflow/output-parser.js";
import type { WorkflowDefinition } from "../src/workflow/types.js";

describe("extractVerdict", () => {
  it("returns APPROVED for exact line match", () => {
    expect(extractVerdict("Verdict: APPROVED")).toBe("APPROVED");
  });

  it("returns NEEDS_REVISION for exact line match", () => {
    expect(extractVerdict("Verdict: NEEDS_REVISION")).toBe("NEEDS_REVISION");
  });

  it("matches verdict embedded in larger output", () => {
    const output = "PLAN_REVIEW:\nVerdict: NEEDS_REVISION\nIssues:\n- foo\nEND_PLAN_REVIEW";
    expect(extractVerdict(output)).toBe("NEEDS_REVISION");
  });

  it("rejects malformed verdict suffixes (NEEDS_REVISION_X) — does not capture suffix", () => {
    expect(extractVerdict("Verdict: NEEDS_REVISION_EXTRA")).toBeNull();
  });

  it("rejects unknown verdict values", () => {
    expect(extractVerdict("Verdict: MAYBE")).toBeNull();
  });

  it("rejects lowercase verdict", () => {
    expect(extractVerdict("Verdict: approved")).toBeNull();
  });

  it("returns null when no Verdict line is present", () => {
    expect(extractVerdict("Some output without verdict")).toBeNull();
  });

  it("first match wins for duplicated verdict lines", () => {
    expect(extractVerdict("Verdict: APPROVED\nVerdict: NEEDS_REVISION")).toBe("APPROVED");
  });

  it("requires line start anchor — Verdict in middle of line is ignored", () => {
    expect(extractVerdict("[note: Verdict: APPROVED] embedded")).toBeNull();
  });
});

describe("extractNextTarget", () => {
  it("returns kebab-case target", () => {
    expect(extractNextTarget("Next: plan-fix")).toBe("plan-fix");
  });

  it("returns single word target", () => {
    expect(extractNextTarget("Next: plan")).toBe("plan");
  });

  it("rejects target with dot (kebab-case-only convention)", () => {
    expect(extractNextTarget("Next: plan.fix")).toBeNull();
  });

  it("rejects target starting with digit", () => {
    expect(extractNextTarget("Next: 1step")).toBeNull();
  });

  it("rejects target starting with uppercase", () => {
    expect(extractNextTarget("Next: Plan")).toBeNull();
  });

  it("returns null when no Next line", () => {
    expect(extractNextTarget("Some output without next")).toBeNull();
  });

  it("matches Next embedded in PLAN_REVIEW block", () => {
    const output = "PLAN_REVIEW:\nVerdict: NEEDS_REVISION\nNext: plan-fix\nIssues:\n- foo\nEND_PLAN_REVIEW";
    expect(extractNextTarget(output)).toBe("plan-fix");
  });
});

describe("isAllowedNextTarget", () => {
  function buildWorkflow(steps: { name: string; agent: string }[]): WorkflowDefinition {
    return {
      name: "test",
      description: "test",
      match: [],
      steps: steps.map((s) => ({
        name: s.name,
        agent: s.agent,
        input: [],
        gate: "none",
        onFail: null,
        maxAttempts: 3,
      })),
    };
  }

  it("allows coder + name ending with -fix", () => {
    const workflow = buildWorkflow([{ name: "plan-fix", agent: "coder" }]);
    expect(isAllowedNextTarget("plan-fix", workflow)).toBe(true);
  });

  it("rejects coder + name not ending with -fix", () => {
    const workflow = buildWorkflow([{ name: "code", agent: "coder" }]);
    expect(isAllowedNextTarget("code", workflow)).toBe(false);
  });

  it("rejects committer + name ending with -fix (only coder allowed)", () => {
    const workflow = buildWorkflow([{ name: "commit-fix", agent: "committer" }]);
    expect(isAllowedNextTarget("commit-fix", workflow)).toBe(false);
  });

  it("rejects target not present in workflow", () => {
    const workflow = buildWorkflow([{ name: "plan-fix", agent: "coder" }]);
    expect(isAllowedNextTarget("missing-fix", workflow)).toBe(false);
  });

  it("rejects commit step", () => {
    const workflow = buildWorkflow([{ name: "commit", agent: "committer" }]);
    expect(isAllowedNextTarget("commit", workflow)).toBe(false);
  });

  it("rejects test step (gate bypass guard)", () => {
    const workflow = buildWorkflow([{ name: "test", agent: "tester" }]);
    expect(isAllowedNextTarget("test", workflow)).toBe(false);
  });
});

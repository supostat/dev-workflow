import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseWorkflowYaml, loadCustomWorkflows } from "../src/workflow/loader.js";

describe("parseWorkflowYaml", () => {
  it("parses a simple workflow", () => {
    const yaml = `
name: simple
description: A simple workflow
steps:
  - name: read
    agent: reader
    gate: none
  - name: code
    agent: coder
    gate: none
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.name).toBe("simple");
    expect(workflow.description).toBe("A simple workflow");
    expect(workflow.steps).toHaveLength(2);
    expect(workflow.steps[0]!.name).toBe("read");
    expect(workflow.steps[0]!.agent).toBe("reader");
    expect(workflow.steps[1]!.name).toBe("code");
    expect(workflow.steps[1]!.agent).toBe("coder");
  });

  it("parses gates and onFail", () => {
    const yaml = `
name: gated
description: Workflow with gates
steps:
  - name: code
    agent: coder
    gate: none
  - name: review
    agent: reviewer
    gate: review-pass
    onFail: code
    maxAttempts: 2
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[1]!.gate).toBe("review-pass");
    expect(workflow.steps[1]!.onFail).toBe("code");
    expect(workflow.steps[1]!.maxAttempts).toBe(2);
  });

  it("parses input arrays", () => {
    const yaml = `
name: inputs
description: Has inputs
steps:
  - name: read
    agent: reader
  - name: code
    agent: coder
    input: [read.output]
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[1]!.input).toEqual(["read.output"]);
  });

  it("defaults gate to none and maxAttempts to 3", () => {
    const yaml = `
name: defaults
description: Test defaults
steps:
  - name: read
    agent: reader
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.gate).toBe("none");
    expect(workflow.steps[0]!.maxAttempts).toBe(3);
    expect(workflow.steps[0]!.onFail).toBeNull();
    expect(workflow.steps[0]!.input).toEqual([]);
  });

  it("parses match field as glob patterns", () => {
    const yaml = `
name: contracts
description: Contracts pipeline
match: [packages/contracts/**, *.sol]
steps:
  - name: read
    agent: reader
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.match).toEqual(["packages/contracts/**", "*.sol"]);
  });

  it("defaults match to empty array", () => {
    const yaml = `
name: simple
description: No match field
steps:
  - name: read
    agent: reader
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.match).toEqual([]);
  });

  it("parses custom-command gate with gateCommand", () => {
    const yaml = `
name: custom
description: Custom command gate
steps:
  - name: lint
    agent: tester
    gate: custom-command
    gateCommand: npm run lint
  - name: code
    agent: coder
    gate: none
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.gate).toBe("custom-command");
    expect(workflow.steps[0]!.gateCommand).toBe("npm run lint");
    expect(workflow.steps[1]!.gateCommand).toBeUndefined();
  });

  it("parses stepFile field", () => {
    const yaml = `
name: custom-steps
description: Workflow with custom step file
steps:
  - name: security-audit
    agent: auditor
    stepFile: .dev-vault/workflow-steps/security-audit.md
  - name: read
    agent: reader
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.stepFile).toBe(".dev-vault/workflow-steps/security-audit.md");
    expect(workflow.steps[1]!.stepFile).toBeUndefined();
  });

  it("parses subagent enum values", () => {
    const yaml = `
name: subagent-hints
description: Workflow with subagent hints
steps:
  - name: scan
    agent: scanner
    subagent: Explore
  - name: apply
    agent: applier
    subagent: Full
  - name: smoke
    agent: smoker
    subagent: bash
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.subagent).toBe("Explore");
    expect(workflow.steps[1]!.subagent).toBe("Full");
    expect(workflow.steps[2]!.subagent).toBe("bash");
  });

  it("silently skips invalid subagent values", () => {
    const yaml = `
name: bad-subagent
description: Invalid subagent value
steps:
  - name: scan
    agent: scanner
    subagent: Unknown
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.subagent).toBeUndefined();
  });

  it("parses outputBlock field", () => {
    const yaml = `
name: custom-block
description: Workflow with custom output block
steps:
  - name: audit
    agent: auditor
    outputBlock: SECURITY_VERDICT
  - name: read
    agent: reader
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.outputBlock).toBe("SECURITY_VERDICT");
    expect(workflow.steps[1]!.outputBlock).toBeUndefined();
  });

  it("defaults stepFile, subagent, and outputBlock to undefined when omitted", () => {
    const yaml = `
name: minimal
description: Minimal workflow
steps:
  - name: read
    agent: reader
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.stepFile).toBeUndefined();
    expect(workflow.steps[0]!.subagent).toBeUndefined();
    expect(workflow.steps[0]!.outputBlock).toBeUndefined();
  });

  it("treats empty strings as undefined for stepFile and outputBlock, case-mismatched as invalid subagent", () => {
    const yaml = `
name: empties
description: Empty and invalid values
steps:
  - name: first
    agent: first
    stepFile:
    subagent: explore
    outputBlock:
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.stepFile).toBeUndefined();
    expect(workflow.steps[0]!.subagent).toBeUndefined();
    expect(workflow.steps[0]!.outputBlock).toBeUndefined();
  });

  it("parses stepFile, subagent, and outputBlock together in one step", () => {
    const yaml = `
name: combined
description: All three fields together
steps:
  - name: audit
    agent: auditor
    stepFile: .dev-vault/workflow-steps/audit.md
    subagent: Explore
    outputBlock: AUDIT_REPORT
    gate: review-pass
    onFail: code
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.stepFile).toBe(".dev-vault/workflow-steps/audit.md");
    expect(workflow.steps[0]!.subagent).toBe("Explore");
    expect(workflow.steps[0]!.outputBlock).toBe("AUDIT_REPORT");
    expect(workflow.steps[0]!.gate).toBe("review-pass");
    expect(workflow.steps[0]!.onFail).toBe("code");
  });

  it("throws for missing name", () => {
    const yaml = `
description: No name
steps:
  - name: read
    agent: reader
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow("missing 'name'");
  });

  it("throws for no steps", () => {
    const yaml = `
name: empty
description: No steps
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow("no steps");
  });

  it("uses step name as agent if agent not specified", () => {
    const yaml = `
name: implicit
description: Implicit agents
steps:
  - name: reader
  - name: coder
`;
    const workflow = parseWorkflowYaml(yaml);

    expect(workflow.steps[0]!.agent).toBe("reader");
    expect(workflow.steps[1]!.agent).toBe("coder");
  });
});

describe("loadCustomWorkflows", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = join(tmpdir(), `dev-vault-loader-test-${Date.now()}`, ".dev-vault");
    mkdirSync(join(vaultPath, "workflows"), { recursive: true });
  });

  afterEach(() => {
    rmSync(join(vaultPath, ".."), { recursive: true, force: true });
  });

  it("loads yaml files from workflows directory", () => {
    writeFileSync(join(vaultPath, "workflows", "deploy.yaml"), `
name: deploy
description: Deploy workflow
steps:
  - name: test
    agent: tester
    gate: tests-pass
`, "utf-8");

    const workflows = loadCustomWorkflows(vaultPath);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.name).toBe("deploy");
  });

  it("loads yml files too", () => {
    writeFileSync(join(vaultPath, "workflows", "custom.yml"), `
name: custom
description: Custom
steps:
  - name: read
    agent: reader
`, "utf-8");

    const workflows = loadCustomWorkflows(vaultPath);

    expect(workflows).toHaveLength(1);
  });

  it("returns empty for missing directory", () => {
    rmSync(join(vaultPath, "workflows"), { recursive: true });
    const workflows = loadCustomWorkflows(vaultPath);

    expect(workflows).toHaveLength(0);
  });

  it("skips malformed yaml files and emits stderr warning for each", () => {
    writeFileSync(join(vaultPath, "workflows", "good.yaml"), `
name: good
description: Good
steps:
  - name: read
    agent: reader
`, "utf-8");

    writeFileSync(join(vaultPath, "workflows", "bad.yaml"), `
this is not valid yaml for a workflow
`, "utf-8");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const workflows = loadCustomWorkflows(vaultPath);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.name).toBe("good");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const message = String(stderrSpy.mock.calls[0]![0]);
    expect(message).toContain("warning: failed to load workflow at");
    expect(message).toContain("bad.yaml");
    expect(message).toContain("missing 'name'");
    stderrSpy.mockRestore();
  });

  it("emits one stderr warning per malformed file when multiple are malformed", () => {
    writeFileSync(join(vaultPath, "workflows", "good.yaml"), `
name: good
description: Good
steps:
  - name: read
    agent: reader
`, "utf-8");

    writeFileSync(join(vaultPath, "workflows", "missing-name.yaml"), `
description: no name field
steps:
  - name: read
    agent: reader
`, "utf-8");

    writeFileSync(join(vaultPath, "workflows", "no-steps.yaml"), `
name: empty
description: has no steps
`, "utf-8");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const workflows = loadCustomWorkflows(vaultPath);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.name).toBe("good");
    expect(stderrSpy).toHaveBeenCalledTimes(2);
    const messages = stderrSpy.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("missing-name.yaml") && m.includes("missing 'name'"))).toBe(true);
    expect(messages.some((m) => m.includes("no-steps.yaml") && m.includes("no steps"))).toBe(true);
    stderrSpy.mockRestore();
  });

  it("ignores non-yaml files", () => {
    writeFileSync(join(vaultPath, "workflows", "run-2026-03-31-001.json"), `{}`, "utf-8");
    writeFileSync(join(vaultPath, "workflows", "test.yaml"), `
name: test
description: Test
steps:
  - name: read
    agent: reader
`, "utf-8");

    const workflows = loadCustomWorkflows(vaultPath);

    expect(workflows).toHaveLength(1);
  });
});

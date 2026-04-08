import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("skips malformed yaml files", () => {
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

    const workflows = loadCustomWorkflows(vaultPath);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.name).toBe("good");
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

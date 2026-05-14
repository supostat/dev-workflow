import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validate } from "../src/cli/run.js";

function writeWorkflowYaml(dir: string, content: string): string {
  const filepath = join(dir, "workflow.yaml");
  writeFileSync(filepath, content, "utf-8");
  return filepath;
}

describe("validate CLI command", () => {
  let logOutput: string[];
  let errOutput: string[];
  let origLog: typeof console.log;
  let origErr: typeof console.error;
  let projectRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), "cli-validate-test-"));
    process.chdir(projectRoot);

    logOutput = [];
    errOutput = [];
    origLog = console.log;
    origErr = console.error;
    console.log = ((msg: string) => { logOutput.push(String(msg)); return true; }) as typeof console.log;
    console.error = ((msg: string) => { errOutput.push(String(msg)); return true; }) as typeof console.error;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.chdir(originalCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function joinedLog(): string { return logOutput.join("\n"); }
  function joinedErr(): string { return errOutput.join("\n"); }

  it("exits 1 and prints usage when filepath is missing", () => {
    validate([]);
    expect(process.exitCode).toBe(1);
    expect(joinedErr()).toContain("Usage: dev-workflow validate");
  });

  it("prints workflow name/description/steps for a valid minimal workflow with no warnings", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: simple\ndescription: Simple workflow\nsteps:\n  - name: read\n    agent: reader\n`);
    validate([filepath]);
    expect(process.exitCode).not.toBe(1);
    expect(joinedLog()).toContain("Valid workflow: simple");
    expect(joinedLog()).toContain("Description: Simple workflow");
    expect(joinedLog()).toContain("Steps: 1");
    expect(joinedLog()).not.toContain("Warnings:");
  });

  it("warns when workflow name contains uppercase letters", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: MyFlow\ndescription: test\nsteps:\n  - name: read\n    agent: reader\n`);
    validate([filepath]);
    expect(process.exitCode).not.toBe(1);
    expect(joinedLog()).toContain("Warnings:");
    expect(joinedLog()).toContain(`workflow name "MyFlow" does not match`);
  });

  it("warns when workflow name starts with hyphen", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: -bad-name\ndescription: test\nsteps:\n  - name: read\n    agent: reader\n`);
    validate([filepath]);
    expect(joinedLog()).toContain(`workflow name "-bad-name" does not match`);
  });

  it("warns when dev-class workflow (uses coder) lacks vault-updates step", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: devflow\ndescription: test\nsteps:\n  - name: code\n    agent: coder\n`);
    validate([filepath]);
    expect(joinedLog()).toContain('dev-class workflow (uses coder/committer) should declare a "vault-updates" step');
  });

  it("warns when dev-class workflow (uses committer) lacks vault-updates step", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: commitflow\ndescription: test\nsteps:\n  - name: commit\n    agent: committer\n`);
    validate([filepath]);
    expect(joinedLog()).toContain('dev-class workflow');
  });

  it("does not warn about vault-updates for a non-dev workflow", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: readonly\ndescription: test\nsteps:\n  - name: read\n    agent: reader\n`);
    validate([filepath]);
    expect(joinedLog()).not.toContain("dev-class workflow");
  });

  it("warns when outputBlock is not UPPER_SNAKE_CASE", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: read\n    agent: reader\n    outputBlock: code_done\n`);
    validate([filepath]);
    expect(joinedLog()).toContain(`outputBlock "code_done" does not match`);
  });

  it("does not warn for valid UPPER_SNAKE outputBlock", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: read\n    agent: reader\n    outputBlock: CODE_DONE\n`);
    validate([filepath]);
    expect(joinedLog()).not.toContain("outputBlock");
  });

  it("warns when onFail references a step that does not exist", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: review\n    agent: reviewer\n    onFail: nonexistent\n`);
    validate([filepath]);
    expect(joinedLog()).toContain(`onFail references unknown step "nonexistent"`);
  });

  it("does not warn when onFail references an existing step", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: read\n    agent: reader\n  - name: review\n    agent: reviewer\n    onFail: read\n`);
    validate([filepath]);
    expect(joinedLog()).not.toContain("onFail references unknown step");
  });

  it("warns when step.agent is not in bundled or custom agent registry", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: read\n    agent: nonexistent_agent_xyz\n`);
    validate([filepath]);
    expect(joinedLog()).toContain('agent "nonexistent_agent_xyz" not found');
  });

  it("does not warn for builtin agents (reader / coder / reviewer / etc.)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: read\n    agent: reader\n  - name: code\n    agent: coder\n  - name: vault-updates\n    agent: vault-updates\n`);
    validate([filepath]);
    expect(joinedLog()).not.toContain("not found in bundled");
  });

  it("does not warn for custom agent declared in .dev-vault/agents/", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "agents"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "agents", "my-custom-agent.md"),
      `---\nname: my-custom-agent\ndescription: Custom for project\nvault: []\n---\n## Permissions (VIOLATION = ABORT)\n\n- Read allowed.\n\nBody\n`,
      "utf-8");
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: special\n    agent: my-custom-agent\n`);
    validate([filepath]);
    expect(joinedLog()).not.toContain("not found in bundled");
    expect(joinedLog()).not.toContain('missing canonical "## Permissions');
  });

  it("warns when custom agent in .dev-vault/agents/ lacks canonical Permissions block", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "agents"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "agents", "leaky.md"),
      `---\nname: leaky\ndescription: missing Permissions block\nwrite: []\n---\nBody without canonical heading\n`,
      "utf-8");
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: special\n    agent: leaky\n`);
    validate([filepath]);
    const log = joinedLog();
    expect(log).toContain('custom agent "leaky" at .dev-vault/agents/leaky.md');
    expect(log).toContain('missing canonical "## Permissions (VIOLATION = ABORT)" block');
    expect(log).toContain("agent inherits full general-purpose tool surface");
  });

  it("scans ALL custom agents regardless of workflow references (project-hygiene scope)", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "agents"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "agents", "used.md"),
      `---\nname: used\ndescription: referenced by workflow\n---\n## Permissions (VIOLATION = ABORT)\n\n- ok\n`,
      "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "agents", "unused.md"),
      `---\nname: unused\ndescription: NOT referenced by workflow\n---\nBody without canonical heading\n`,
      "utf-8");
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: a\n    agent: used\n`);
    validate([filepath]);
    expect(joinedLog()).toContain('custom agent "unused" at .dev-vault/agents/unused.md');
    expect(joinedLog()).not.toContain('custom agent "used"');
  });

  it("does not warn when .dev-vault/agents/ does not exist", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: a\n    agent: reader\n`);
    validate([filepath]);
    const log = joinedLog();
    expect(log).not.toContain("missing canonical");
    expect(log).not.toContain("failed to parse");
  });

  it("emits 'failed to parse' warning when custom agent file is malformed (missing name field)", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "agents"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "agents", "broken.md"),
      `---\ndescription: no name field\nvault: []\n---\nBody without name\n`,
      "utf-8");
    writeFileSync(join(projectRoot, ".dev-vault", "agents", "good.md"),
      `---\nname: good\ndescription: well-formed sibling\nvault: []\n---\n## Permissions (VIOLATION = ABORT)\n\n- Read allowed.\n`,
      "utf-8");
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: a\n    agent: good\n`);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    validate([filepath]);

    expect(process.exitCode).not.toBe(1);
    const log = joinedLog();
    expect(log).toContain('custom agent ".dev-vault/agents/broken.md" failed to parse');
    expect(log).toContain("missing 'name'");
    // Sibling well-formed agent should not trigger "missing canonical" warning
    expect(log).not.toContain('custom agent "good"');
    // AgentRegistry constructor also emits its own stderr warning for the malformed file
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("warns when stepFile contains .. (path traversal)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: custom\n    agent: reader\n    stepFile: ../escape.md\n`);
    validate([filepath]);
    expect(process.exitCode).not.toBe(1);
    expect(joinedLog()).toContain('stepFile "../escape.md" contains ".."');
  });

  it("warns when stepFile is an absolute path", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: custom\n    agent: reader\n    stepFile: /etc/passwd\n`);
    validate([filepath]);
    expect(joinedLog()).toContain('stepFile "/etc/passwd" is absolute');
  });

  it("warns when stepFile resolves outside allowed directories", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: custom\n    agent: reader\n    stepFile: src/custom-step.md\n`);
    validate([filepath]);
    expect(joinedLog()).toContain("resolves outside allowed directories");
  });

  it("does not warn when stepFile exists under .dev-vault/workflow-steps/", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "workflow-steps"), { recursive: true });
    writeFileSync(join(projectRoot, ".dev-vault", "workflow-steps", "custom-step.md"), "# Custom step\n");
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: custom\n    agent: reader\n    stepFile: .dev-vault/workflow-steps/custom-step.md\n`);
    validate([filepath]);
    const out = joinedLog();
    expect(out).not.toContain("stepFile");
    expect(out).not.toContain("Warnings:");
  });

  it("warns when stepFile path is inside allowed dir but file does not exist", () => {
    mkdirSync(join(projectRoot, ".dev-vault", "workflow-steps"), { recursive: true });
    const filepath = writeWorkflowYaml(projectRoot,
      `name: flow\ndescription: test\nsteps:\n  - name: custom\n    agent: reader\n    stepFile: .dev-vault/workflow-steps/missing.md\n`);
    validate([filepath]);
    expect(joinedLog()).toContain("does not exist");
  });

  it("does not warn about vault-updates when dev-class workflow includes vault-updates step", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: devflow\ndescription: test\nsteps:\n  - name: code\n    agent: coder\n  - name: vault-updates\n    agent: vault-updates\n`);
    validate([filepath]);
    expect(process.exitCode).not.toBe(1);
    expect(joinedLog()).not.toContain("dev-class workflow");
  });

  it("exits 1 and prints error when workflow file does not exist", () => {
    validate([join(projectRoot, "nonexistent.yaml")]);
    expect(process.exitCode).toBe(1);
    expect(joinedErr()).toContain("Invalid workflow");
  });

  it("exits 1 and prints error for malformed YAML", () => {
    const filepath = writeWorkflowYaml(projectRoot, "steps:\n  - incomplete without name");
    validate([filepath]);
    expect(process.exitCode).toBe(1);
    expect(joinedErr()).toContain("Invalid workflow");
  });

  it("aggregates multiple warnings in one workflow", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: BadName\ndescription: test\nsteps:\n  - name: step1\n    agent: reader\n    outputBlock: bad_case\n    onFail: nonexistent\n`);
    validate([filepath]);
    expect(process.exitCode).not.toBe(1);
    const out = joinedLog();
    expect(out).toContain(`workflow name "BadName"`);
    expect(out).toContain(`outputBlock "bad_case"`);
    expect(out).toContain(`onFail references unknown step "nonexistent"`);
  });

  it("warns when onFail routes Full agent (coder) to Explore agent (reader)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: full-to-explore\ndescription: test\nsteps:\n  - name: read\n    agent: reader\n  - name: code\n    agent: coder\n    onFail: read\n`);
    validate([filepath]);
    expect(joinedLog()).toContain(`onFail target "read" routes Full agent`);
    expect(joinedLog()).toContain(`Explore agent`);
  });

  it("does not warn when onFail routes Explore agent (reviewer) to Full agent (coder)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: explore-to-full\ndescription: test\nsteps:\n  - name: code\n    agent: coder\n  - name: review\n    agent: reviewer\n    onFail: code\n`);
    validate([filepath]);
    expect(joinedLog()).not.toContain("Full agent");
    expect(joinedLog()).not.toContain("Explore agent");
  });

  it("does not warn for plan-review onFail to plan-fix (Explore to Full, documented pattern)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: planflow\ndescription: test\nsteps:\n  - name: plan\n    agent: planner\n  - name: plan-review\n    agent: plan-reviewer\n    onFail: plan-fix\n  - name: plan-fix\n    agent: coder\n`);
    validate([filepath]);
    expect(joinedLog()).not.toContain("routes Full");
  });

  it("warns when onFail forms a cycle (A -> B -> A)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: cycle\ndescription: test\nsteps:\n  - name: a\n    agent: reader\n    onFail: b\n  - name: b\n    agent: planner\n    onFail: a\n`);
    validate([filepath]);
    expect(joinedLog()).toContain(`onFail forms a cycle`);
  });

  it("warns when onFail self-loops (A -> A)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: selfloop\ndescription: test\nsteps:\n  - name: a\n    agent: reader\n    onFail: a\n`);
    validate([filepath]);
    expect(joinedLog()).toContain(`onFail forms a cycle`);
  });

  it("does not warn on linear onFail chains without cycles", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: linear\ndescription: test\nsteps:\n  - name: a\n    agent: reader\n  - name: b\n    agent: planner\n    onFail: a\n  - name: c\n    agent: reviewer\n    onFail: b\n`);
    validate([filepath]);
    expect(joinedLog()).not.toContain("cycle");
  });

  it("does not warn on cycle when target is unknown step (existing onFail-references-unknown warning takes precedence)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: unknown-target\ndescription: test\nsteps:\n  - name: a\n    agent: reader\n    onFail: nowhere\n`);
    validate([filepath]);
    expect(joinedLog()).toContain(`onFail references unknown step "nowhere"`);
    expect(joinedLog()).not.toContain("cycle");
  });

  it("detects long onFail cycles (A -> B -> C -> D -> A)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: longcycle\ndescription: test\nsteps:\n  - name: a\n    agent: reader\n    onFail: b\n  - name: b\n    agent: planner\n    onFail: c\n  - name: c\n    agent: reviewer\n    onFail: d\n  - name: d\n    agent: verifier\n    onFail: a\n`);
    validate([filepath]);
    expect(joinedLog()).toContain(`onFail forms a cycle`);
  });

  it("warns once per source for branch pattern (two steps with same onFail target into a cycle)", () => {
    const filepath = writeWorkflowYaml(projectRoot,
      `name: branch\ndescription: test\nsteps:\n  - name: a\n    agent: reader\n    onFail: c\n  - name: b\n    agent: planner\n    onFail: c\n  - name: c\n    agent: reviewer\n    onFail: a\n`);
    validate([filepath]);
    const out = joinedLog();
    const matches = out.match(/onFail forms a cycle/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

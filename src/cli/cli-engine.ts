import { join } from "node:path";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { AgentRegistry } from "../agents/registry.js";
import { AgentContextBuilder } from "../agents/context-builder.js";
import { TaskManager } from "../tasks/manager.js";
import { WorkflowEngine } from "../workflow/engine.js";
import type { StepExecutor, GateChecker } from "../workflow/engine.js";
import { WorkflowState } from "../workflow/state.js";
import { ALLOWED_GATE_BINARIES, runGateBinary } from "../workflow/gate-runner.js";
import { resolveWorkflow } from "../workflow/resolver.js";
import type { PreparedAgent } from "../agents/types.js";
import type { WorkflowDefinition } from "../workflow/types.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";

class CliStepExecutor implements StepExecutor {
  async execute(agent: PreparedAgent): Promise<string> {
    console.log(`\n--- Agent: ${agent.definition.name} ---`);
    console.log(agent.resolvedPrompt);
    console.log(`--- End ---\n`);
    return "Executed via CLI output";
  }
}

export class CliGateChecker implements GateChecker {
  /**
   * Run the project's test command (trusted source — comes from
   * `agent.permissions.shellCommands[0]` set in agent definitions, NOT from
   * user-supplied workflow YAML). No allowlist check: the threat model treats
   * agent definitions as trusted (bundled, version-controlled). Empty/invalid
   * input returns false silently — caller handles boolean as gate result.
   */
  async checkTestsPass(command: string): Promise<boolean> {
    const [bin, ...args] = command.trim().split(/\s+/);
    if (!bin) return false;
    return runGateBinary(bin, args);
  }

  checkReviewPass(reviewOutput: string): boolean {
    return !/severity:\s*(high|critical)/i.test(reviewOutput)
      && !/\bBLOCKER\b/.test(reviewOutput)
      && !/\bMUST FIX\b/i.test(reviewOutput);
  }

  async requestUserApproval(stepName: string, context: string): Promise<boolean> {
    console.log(`\nStep '${stepName}' requires approval.`);
    console.log(context);
    return true;
  }

  /**
   * Run a user-supplied `gateCommand` from workflow YAML. Untrusted input —
   * THROWS on allowlist rejection (the engine catches and marks the step
   * failed with the message). Non-zero exit returns false (gate fails
   * cleanly, no throw). Asymmetric with `checkTestsPass`: only this method
   * exposes user YAML to spawn, so only this one needs the allowlist.
   */
  async checkCustomCommand(command: string): Promise<boolean> {
    const [bin, ...args] = command.trim().split(/\s+/);
    if (!bin) {
      throw new Error(
        "gateCommand is empty after trim/split — must be \"<allowed-binary> [args]\". " +
        `Allowed binaries: ${[...ALLOWED_GATE_BINARIES].sort().join(", ")}.`,
      );
    }
    if (!ALLOWED_GATE_BINARIES.has(bin)) {
      throw new Error(
        `gateCommand binary "${bin}" is not in the allowlist. ` +
        `Allowed: ${[...ALLOWED_GATE_BINARIES].sort().join(", ")}. ` +
        "Shell metacharacters (|, ;, &&, $, backtick) and arbitrary binaries are blocked " +
        "to prevent RCE via YAML injection. To compose multiple commands, move them to a " +
        "script file invoked via an allowlisted binary (e.g. \"node scripts/gate.js\").",
      );
    }
    return runGateBinary(bin, args);
  }
}

export function createEngine(vaultPath: string, projectRoot: string) {
  const context = detectContext(projectRoot)!;
  const vaultReader = new VaultReader(context);
  const agentsDir = join(PACKAGE_ROOT, "templates", "agents");
  const customAgentsDir = join(vaultPath, "agents");
  const registry = new AgentRegistry(agentsDir, customAgentsDir);
  const contextBuilder = new AgentContextBuilder(vaultReader, context);
  const state = new WorkflowState(vaultPath);
  const taskManager = new TaskManager(vaultPath);
  const resolver = { resolve: (name: string): WorkflowDefinition => resolveWorkflow(name, vaultPath) };

  return new WorkflowEngine(
    registry, contextBuilder, state, taskManager,
    new CliStepExecutor(), new CliGateChecker(), resolver,
  );
}

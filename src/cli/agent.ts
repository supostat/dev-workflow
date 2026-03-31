import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { AgentRegistry } from "../agents/registry.js";
import { AgentContextBuilder } from "../agents/context-builder.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function createServices() {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return null;
  }

  const vaultReader = new VaultReader(context);
  const agentsDir = join(PACKAGE_ROOT, "templates", "agents");
  const customAgentsDir = join(context.vaultPath, "agents");
  const registry = new AgentRegistry(agentsDir, customAgentsDir);
  const contextBuilder = new AgentContextBuilder(vaultReader, context);

  return { context, registry, contextBuilder };
}

export function agent(args: string[]): void {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      agentList();
      break;
    case "show":
      agentShow(args[1]);
      break;
    case "run":
      agentRun(args[1], args.slice(2).join(" "));
      break;
    default:
      console.error("Usage: dev-workflow agent list|show|run");
      console.error("  agent list              List available agents");
      console.error("  agent show <name>       Show agent details");
      console.error("  agent run <name> \"task\" Run agent with vault context");
      process.exitCode = 1;
  }
}

function agentList(): void {
  const services = createServices();
  if (!services) return;

  const agents = services.registry.list();

  console.log("Name".padEnd(14) + "Vault Sections".padEnd(36) + "Write Patterns");
  console.log("-".repeat(70));

  for (const agentDef of agents) {
    const vault = agentDef.vaultSections.length === 6
      ? "all"
      : agentDef.vaultSections.join(", ") || "none";
    const write = agentDef.permissions.writePatterns.join(", ") || "—";
    console.log(agentDef.name.padEnd(14) + vault.padEnd(36) + write);
  }
}

function agentShow(name: string | undefined): void {
  if (!name) {
    console.error("Usage: dev-workflow agent show <name>");
    process.exitCode = 1;
    return;
  }

  const services = createServices();
  if (!services) return;

  try {
    const agentDef = services.registry.get(name);
    console.log(`Name:         ${agentDef.name}`);
    console.log(`Description:  ${agentDef.description}`);
    console.log(`Vault:        ${agentDef.vaultSections.join(", ") || "none"}`);
    console.log(`Read files:   ${agentDef.permissions.readFiles}`);
    console.log(`Write:        ${agentDef.permissions.writePatterns.join(", ") || "none"}`);
    console.log(`Shell:        ${agentDef.permissions.shellCommands.join(", ") || "none"}`);
    console.log(`Git:          ${agentDef.permissions.gitOperations.join(", ") || "none"}`);
    console.log(`\n--- System Prompt ---\n${agentDef.systemPrompt}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Agent not found");
    process.exitCode = 1;
  }
}

function agentRun(name: string | undefined, taskDescription: string): void {
  if (!name || !taskDescription) {
    console.error("Usage: dev-workflow agent run <name> \"task description\"");
    process.exitCode = 1;
    return;
  }

  const services = createServices();
  if (!services) return;

  try {
    const agentDef = services.registry.get(name);
    const prepared = services.contextBuilder.prepare(agentDef, { taskDescription });
    console.log(prepared.resolvedPrompt);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "Agent not found");
    process.exitCode = 1;
  }
}

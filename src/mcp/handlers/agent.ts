import type { AgentRegistry } from "../../agents/registry.js";
import type { AgentContextBuilder } from "../../agents/context-builder.js";

export function agentList(registry: AgentRegistry): unknown {
  return registry.list().map((agent) => ({
    name: agent.name,
    description: agent.description,
    vaultSections: agent.vaultSections,
    permissions: agent.permissions,
  }));
}

export async function agentRun(
  registry: AgentRegistry,
  contextBuilder: AgentContextBuilder,
  agentName: string,
  task: string,
): Promise<unknown> {
  const agent = registry.get(agentName);
  const prepared = await contextBuilder.prepare(agent, { taskDescription: task });
  return {
    prompt: prepared.resolvedPrompt,
    permissions: agent.permissions,
  };
}

import type { VaultReader } from "../lib/reader.js";
import type { ProjectContext } from "../lib/types.js";
import { interpolate } from "../lib/interpolate.js";
import type { AgentDefinition, PreparedAgent, VaultSection } from "./types.js";

export class AgentContextBuilder {
  private readonly vaultReader: VaultReader;
  private readonly context: ProjectContext;

  constructor(vaultReader: VaultReader, context: ProjectContext) {
    this.vaultReader = vaultReader;
    this.context = context;
  }

  prepare(
    agent: AgentDefinition,
    variables: Record<string, string> = {},
  ): PreparedAgent {
    const vaultVariables = this.collectVaultSections(agent.vaultSections);

    const mergedVariables: Record<string, string> = {
      projectName: this.context.projectName,
      branch: this.context.branch,
      parentBranch: this.context.parentBranch,
      ...vaultVariables,
      ...variables,
    };

    const resolvedPrompt = interpolate(agent.systemPrompt, mergedVariables);

    return {
      definition: agent,
      resolvedPrompt,
    };
  }

  private collectVaultSections(sections: VaultSection[]): Record<string, string> {
    const result: Record<string, string> = {};

    const sectionReaders: Record<VaultSection, () => string | null> = {
      stack: () => this.vaultReader.readStack(),
      conventions: () => this.vaultReader.readConventions(),
      knowledge: () => this.vaultReader.readKnowledge(),
      gameplan: () => this.vaultReader.readGameplan(),
      branch: () => {
        const branchData = this.vaultReader.readBranch(this.context.branch);
        if (!branchData) return null;
        return branchData.raw;
      },
      dailyLogs: () => {
        const logs = this.vaultReader.readRecentDailyLogs(3);
        if (logs.length === 0) return null;
        return logs.map((log) => `### ${log.date}\n${log.content}`).join("\n\n");
      },
    };

    const variableNames: Record<VaultSection, string> = {
      stack: "stack",
      conventions: "conventions",
      knowledge: "knowledge",
      gameplan: "gameplan",
      branch: "branchContext",
      dailyLogs: "dailyLogs",
    };

    for (const section of sections) {
      const reader = sectionReaders[section];
      const content = reader();
      if (content) {
        result[variableNames[section]] = content;
      }
    }

    return result;
  }
}

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseAgentFile } from "./loader.js";
import type { AgentDefinition } from "./types.js";

export class AgentRegistry {
  private readonly agents: Map<string, AgentDefinition> = new Map();

  constructor(builtinDir: string, customDir?: string) {
    this.loadDirectory(builtinDir);

    if (customDir && existsSync(customDir)) {
      this.loadDirectory(customDir);
    }
  }

  list(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  get(name: string): AgentDefinition {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent not found: ${name}`);
    }
    return agent;
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  private loadDirectory(directory: string): void {
    if (!existsSync(directory)) return;

    const files = readdirSync(directory).filter((file) => file.endsWith(".md"));

    for (const file of files) {
      const definition = parseAgentFile(join(directory, file));
      this.agents.set(definition.name, definition);
    }
  }
}

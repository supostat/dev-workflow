import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { VaultReader } from "../lib/reader.js";
import type { VaultWriter } from "../lib/writer.js";
import type { ProjectContext } from "../lib/types.js";
import { renderTemplate } from "../lib/templates.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentContextBuilder } from "../agents/context-builder.js";
import type { TaskManager } from "../tasks/manager.js";
import type { TaskStatus } from "../tasks/types.js";
import { WorkflowState } from "../workflow/state.js";

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return value;
}

interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

function searchVaultFiles(vaultPath: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  function scanDirectory(directory: string): void {
    if (!existsSync(directory)) return;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.toLowerCase().includes(lowerQuery)) {
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length, i + 3);
            matches.push({
              file: relative(vaultPath, fullPath),
              line: i + 1,
              content: lines.slice(start, end).join("\n"),
            });
          }
        }
      }
    }
  }

  scanDirectory(vaultPath);
  return matches;
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export class ToolHandlers {
  private readonly vaultReader: VaultReader;
  private readonly vaultWriter: VaultWriter;
  private readonly context: ProjectContext;
  private readonly agentRegistry: AgentRegistry;
  private readonly contextBuilder: AgentContextBuilder;
  private readonly taskManager: TaskManager;

  constructor(
    vaultReader: VaultReader,
    vaultWriter: VaultWriter,
    context: ProjectContext,
    agentRegistry: AgentRegistry,
    contextBuilder: AgentContextBuilder,
    taskManager: TaskManager,
  ) {
    this.vaultReader = vaultReader;
    this.vaultWriter = vaultWriter;
    this.context = context;
    this.agentRegistry = agentRegistry;
    this.contextBuilder = contextBuilder;
    this.taskManager = taskManager;
  }

  async handle(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case "vault_read":
        return this.vaultRead(requireString(params, "section"));

      case "vault_search":
        return this.vaultSearch(requireString(params, "query"));

      case "vault_record":
        return this.vaultRecord(
          requireString(params, "type"),
          requireString(params, "title"),
          requireString(params, "content"),
        );

      case "vault_knowledge":
        return this.vaultKnowledge(
          requireString(params, "section"),
          requireString(params, "content"),
        );

      case "workflow_run":
        return { message: "Use 'dev-workflow run <workflow> \"task\"' from CLI to execute workflows." };

      case "workflow_status":
        return this.workflowStatus(optionalString(params, "runId"));

      case "workflow_resume":
        return { message: "Use 'dev-workflow resume' from CLI to resume paused workflows." };

      case "task_create":
        return this.taskCreate(
          requireString(params, "title"),
          optionalString(params, "description"),
        );

      case "task_list":
        return this.taskList(optionalString(params, "status"));

      case "task_update":
        return this.taskUpdate(
          requireString(params, "id"),
          optionalString(params, "status"),
          optionalString(params, "description"),
        );

      case "agent_list":
        return this.agentList();

      case "agent_run":
        return this.agentRun(
          requireString(params, "agent"),
          requireString(params, "task"),
        );

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private vaultRead(section: string): string | null {
    const readers: Record<string, () => string | null> = {
      stack: () => this.vaultReader.readStack(),
      conventions: () => this.vaultReader.readConventions(),
      knowledge: () => this.vaultReader.readKnowledge(),
      gameplan: () => this.vaultReader.readGameplan(),
    };

    const reader = readers[section];
    if (!reader) throw new Error(`Unknown vault section: ${section}`);
    return reader();
  }

  private vaultSearch(query: string): SearchMatch[] {
    return searchVaultFiles(this.context.vaultPath, query);
  }

  private vaultRecord(type: string, title: string, content: string): { filepath: string } {
    const slug = slugifyTitle(title);
    const rendered = renderTemplate(`records/${type}`, {
      title,
      projectName: this.context.projectName,
    });
    const finalContent = rendered + "\n" + content;
    const filepath = this.vaultWriter.writeRecord(type, slug, finalContent);
    return { filepath };
  }

  private vaultKnowledge(section: string, content: string): { success: boolean } {
    this.vaultWriter.appendKnowledge(section, content);
    return { success: true };
  }

  private taskCreate(title: string, description?: string): unknown {
    return this.taskManager.create(title, description ?? "");
  }

  private taskList(status?: string): unknown {
    const filter = status ? { status: status as TaskStatus } : undefined;
    return this.taskManager.list(filter);
  }

  private taskUpdate(id: string, status?: string, description?: string): unknown {
    const patch: Record<string, unknown> = {};
    if (status) patch["status"] = status;
    if (description) patch["description"] = description;
    return this.taskManager.update(id, patch as { status?: TaskStatus; description?: string });
  }

  private agentList(): unknown {
    return this.agentRegistry.list().map((agent) => ({
      name: agent.name,
      description: agent.description,
      vaultSections: agent.vaultSections,
      permissions: agent.permissions,
    }));
  }

  private workflowStatus(runId?: string): unknown {
    const state = new WorkflowState(this.context.vaultPath);
    if (runId) {
      try {
        return state.load(runId);
      } catch {
        return { message: `Workflow run not found: ${runId}` };
      }
    }
    const current = state.loadCurrent();
    if (!current) {
      return { message: "No active workflow." };
    }
    return current;
  }

  private agentRun(agentName: string, task: string): unknown {
    const agent = this.agentRegistry.get(agentName);
    const prepared = this.contextBuilder.prepare(agent, { taskDescription: task });
    return {
      prompt: prepared.resolvedPrompt,
      permissions: agent.permissions,
    };
  }
}

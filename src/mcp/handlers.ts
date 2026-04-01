import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { VaultReader } from "../lib/reader.js";
import type { VaultWriter } from "../lib/writer.js";
import type { ProjectContext } from "../lib/types.js";
import { renderTemplate } from "../lib/templates.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentContextBuilder } from "../agents/context-builder.js";
import type { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import type { TaskStatus } from "../tasks/types.js";
import { WorkflowState } from "../workflow/state.js";
import { IntelligenceStore } from "../intelligence/store.js";
import { topN } from "../intelligence/ranker.js";

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
  private readonly intelligenceStore: IntelligenceStore;
  private readonly taskTracker: TaskTracker;

  constructor(
    vaultReader: VaultReader,
    vaultWriter: VaultWriter,
    context: ProjectContext,
    agentRegistry: AgentRegistry,
    contextBuilder: AgentContextBuilder,
    taskManager: TaskManager,
    intelligenceStore: IntelligenceStore,
    taskTracker: TaskTracker,
  ) {
    this.vaultReader = vaultReader;
    this.vaultWriter = vaultWriter;
    this.context = context;
    this.agentRegistry = agentRegistry;
    this.contextBuilder = contextBuilder;
    this.taskManager = taskManager;
    this.intelligenceStore = intelligenceStore;
    this.taskTracker = taskTracker;
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

      case "vault_status":
        return this.vaultStatus();

      case "workflow_status":
        return this.workflowStatus(optionalString(params, "runId"));

      case "intelligence_query":
        return this.intelligenceQuery(
          optionalString(params, "branch"),
          optionalString(params, "task"),
          params["limit"] as number | undefined,
        );

      case "task_start":
        return this.taskStart(requireString(params, "id"));

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

  private vaultStatus(): unknown {
    const sectionInfo = (content: string | null) => {
      if (!content) return { filled: false, lines: 0 };
      const lines = content.split("\n").length;
      return { filled: lines > 8, lines };
    };

    const tasks = this.taskManager.list();
    const statusCounts: Record<string, number> = {};
    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    }

    const workflowState = new WorkflowState(this.context.vaultPath);
    const currentRun = workflowState.loadCurrent();

    return {
      project: this.context.projectName,
      branch: this.context.branch,
      sections: {
        stack: sectionInfo(this.vaultReader.readStack()),
        conventions: sectionInfo(this.vaultReader.readConventions()),
        knowledge: sectionInfo(this.vaultReader.readKnowledge()),
        gameplan: sectionInfo(this.vaultReader.readGameplan()),
      },
      tasks: {
        total: tasks.length,
        ...statusCounts,
      },
      workflow: currentRun ? {
        active: true,
        name: currentRun.workflowName,
        step: currentRun.currentStep,
        status: currentRun.status,
      } : null,
      intelligence: {
        patterns: this.intelligenceStore.nodeCount(),
        edges: this.intelligenceStore.edgeCount(),
      },
    };
  }

  private intelligenceQuery(branch?: string, task?: string, limit?: number): unknown {
    const scoringContext = {
      branch: branch ?? this.context.branch,
      taskTitle: task ?? null,
      recentFiles: [],
      query: task ?? null,
    };

    const scored = topN(this.intelligenceStore.allNodes(), scoringContext, limit ?? 15);
    return scored.map((entry) => ({
      id: entry.node.id,
      category: entry.node.category,
      content: entry.node.content,
      score: Math.round(entry.score * 1000) / 1000,
      lastAccessed: entry.node.lastAccessed,
    }));
  }

  private taskStart(id: string): unknown {
    const task = this.taskManager.get(id);
    const slug = task.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const branchName = `task/${slug}`;

    this.taskTracker.linkBranch(id, branchName);

    return {
      id: task.id,
      title: task.title,
      status: "in-progress",
      branch: branchName,
    };
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

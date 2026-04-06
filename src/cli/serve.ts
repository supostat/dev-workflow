import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectContext } from "../lib/context.js";
import { VaultReader } from "../lib/reader.js";
import { VaultWriter } from "../lib/writer.js";
import { AgentRegistry } from "../agents/registry.js";
import { AgentContextBuilder } from "../agents/context-builder.js";
import { TaskManager } from "../tasks/manager.js";
import { TaskTracker } from "../tasks/tracker.js";
import { ToolHandlers } from "../mcp/handlers.js";
import { McpServer } from "../mcp/server.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function serve(): void {
  const context = detectContext();
  if (!context) {
    process.stderr.write("Not a git repository.\n");
    process.exitCode = 1;
    return;
  }

  const vaultReader = new VaultReader(context);
  const vaultWriter = new VaultWriter(context);
  const agentsDir = join(PACKAGE_ROOT, "templates", "agents");
  const customAgentsDir = join(context.vaultPath, "agents");
  const registry = new AgentRegistry(agentsDir, customAgentsDir);
  const contextBuilder = new AgentContextBuilder(vaultReader, context);
  const taskManager = new TaskManager(context.vaultPath);

  const taskTracker = new TaskTracker(context.projectRoot, taskManager);

  const handlers = new ToolHandlers(
    vaultReader, vaultWriter, context, registry, contextBuilder, taskManager,
    taskTracker,
  );

  const server = new McpServer(handlers);
  server.start();
}

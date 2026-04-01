#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "./init.js";
import { status } from "./status.js";
import { run, resume, validate } from "./run.js";
import { agent } from "./agent.js";
import { task } from "./task.js";
import { doctor } from "./doctor.js";
import { search } from "./search.js";
import { exportVault, importVault } from "./vault-io.js";
import { config } from "./config.js";
import { update } from "./update.js";

const args = process.argv.slice(2);
const command = args[0];

function handleAsyncError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`
dev-workflow — Development workflow engine with agents for Claude Code

Usage:
  dev-workflow init [--force] [--detect]  Initialize vault
  dev-workflow status                    Show vault and workflow status
  dev-workflow run <workflow> "task"     Run a workflow (--dry-run to preview)
  dev-workflow resume [--run <id>]       Resume paused workflow
  dev-workflow validate <file.yaml>      Validate custom workflow file
  dev-workflow agent list|show|run       Manage agents
  dev-workflow task create|list|...      Manage tasks
  dev-workflow search "query"            Search vault content
  dev-workflow config get|set|show       Manage settings
  dev-workflow export [file.json]        Export vault to JSON
  dev-workflow import <file.json>        Import vault from JSON
  dev-workflow update                    Update commands/agents from package
  dev-workflow doctor [--fix]            Check vault health
  dev-workflow serve                     Start MCP server
  dev-workflow help                      Show this help

Workflows: dev, hotfix, review, test
Agents:    reader, planner, coder, reviewer, tester, committer
`);
}

switch (command) {
  case "init":
    init({ force: args.includes("--force"), detectOnly: args.includes("--detect") });
    break;
  case "status":
    status();
    break;
  case "run":
    run(args.slice(1)).catch(handleAsyncError);
    break;
  case "resume":
    resume(args.slice(1)).catch(handleAsyncError);
    break;
  case "validate":
    validate(args.slice(1));
    break;
  case "agent":
    agent(args.slice(1));
    break;
  case "task":
    task(args.slice(1));
    break;
  case "search":
    search(args.slice(1).join(" "));
    break;
  case "config":
    config(args.slice(1));
    break;
  case "export":
    exportVault(args.slice(1));
    break;
  case "import":
    importVault(args.slice(1));
    break;
  case "update":
    update();
    break;
  case "doctor":
    doctor(args.includes("--fix")).catch(handleAsyncError);
    break;
  case "serve": {
    import("./serve.js").then((m) => m.serve()).catch(handleAsyncError);
    break;
  }
  case "version":
  case "--version":
  case "-v": {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string; version: string };
    console.log(`${pkg.name}@${pkg.version}`);
    break;
  }
  case "help":
  case "--help":
  case "-h":
  case undefined:
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
}

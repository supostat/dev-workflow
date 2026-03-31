#!/usr/bin/env node

import { init } from "./init.js";
import { status } from "./status.js";
import { run, resume } from "./run.js";
import { agent } from "./agent.js";
import { task } from "./task.js";
import { doctor } from "./doctor.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`
dev-workflow — Development workflow engine with agents for Claude Code

Usage:
  dev-workflow init [--force]            Initialize vault in current project
  dev-workflow status                    Show vault and workflow status
  dev-workflow run <workflow> "task"     Run a development workflow
  dev-workflow resume [--run <id>]       Resume paused workflow
  dev-workflow agent list|show|run       Manage agents
  dev-workflow task create|list|...      Manage tasks
  dev-workflow doctor                     Check vault health
  dev-workflow serve                     Start MCP server
  dev-workflow help                      Show this help

Workflows: dev, hotfix, review, test
Agents:    reader, planner, coder, reviewer, tester, committer
`);
}

switch (command) {
  case "init":
    init({ force: args.includes("--force") });
    break;
  case "status":
    status();
    break;
  case "run":
    run(args.slice(1));
    break;
  case "resume":
    resume(args.slice(1));
    break;
  case "agent":
    agent(args.slice(1));
    break;
  case "task":
    task(args.slice(1));
    break;
  case "doctor":
    doctor();
    break;
  case "serve": {
    import("./serve.js").then((m) => m.serve());
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

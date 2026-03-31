#!/usr/bin/env node

import { init } from "./init.js";
import { status } from "./status.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`
dev-vault — Self-managing knowledge base for Claude Code

Usage:
  dev-vault init [--force]   Initialize vault in current project
  dev-vault status           Show vault status
  dev-vault help             Show this help

Options:
  --force   Overwrite existing .claude/ settings
`);
}

switch (command) {
  case "init":
    init({ force: args.includes("--force") });
    break;
  case "status":
    status();
    break;
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

import { resolve as resolvePath, sep } from "node:path";
import { detectContext } from "../lib/context.js";
import { diffSpecVsVault, printDiffReport } from "../lib/spec-diff.js";

const VALID_SUBCOMMANDS = ["diff"] as const;
type VaultSubcommand = (typeof VALID_SUBCOMMANDS)[number];

function printUsage(): void {
  console.error("Usage: dev-workflow vault <subcommand> [args]");
  console.error("");
  console.error("Subcommands:");
  console.error("  diff [SPEC.md]   Compare SPEC against vault sections");
}

function isValidSubcommand(value: string): value is VaultSubcommand {
  return (VALID_SUBCOMMANDS as readonly string[]).includes(value);
}

export function runVaultCommand(args: string[]): void {
  const [subcommand, specArg] = args;

  if (!subcommand) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!isValidSubcommand(subcommand)) {
    console.error(`Unknown subcommand: ${subcommand}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  if (subcommand === "diff") {
    const specPath = specArg ?? "SPEC.md";
    const absSpecPath = resolvePath(context.projectRoot, specPath);
    const absProjectRoot = resolvePath(context.projectRoot);
    if (absSpecPath !== absProjectRoot && !absSpecPath.startsWith(absProjectRoot + sep)) {
      console.error(`Path traversal not allowed: ${specPath}`);
      process.exitCode = 1;
      return;
    }
    try {
      const report = diffSpecVsVault(absSpecPath, context.vaultPath);
      console.log(printDiffReport(report, specPath));
      process.exitCode = report.hasDrift ? 1 : 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "diff failed";
      console.error(message);
      process.exitCode = 1;
    }
  }
}

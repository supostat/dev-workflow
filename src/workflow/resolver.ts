import { join } from "node:path";
import { loadCustomWorkflows } from "./loader.js";
import { getBuiltinWorkflow, getBuiltinWorkflows } from "./builtin.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import type { WorkflowDefinition } from "./types.js";

export function resolveWorkflow(name: string, vaultPath: string): WorkflowDefinition {
  const vaultMatch = loadCustomWorkflows(vaultPath).find((w) => w.name === name);
  if (vaultMatch) return vaultMatch;

  const libraryMatch = loadCustomWorkflows(join(PACKAGE_ROOT, "templates")).find((w) => w.name === name);
  if (libraryMatch) return libraryMatch;

  return getBuiltinWorkflow(name);
}

export function listAvailableWorkflows(vaultPath: string): string[] {
  const names = new Set<string>();
  for (const workflow of loadCustomWorkflows(vaultPath)) names.add(workflow.name);
  for (const workflow of loadCustomWorkflows(join(PACKAGE_ROOT, "templates"))) names.add(workflow.name);
  for (const workflow of getBuiltinWorkflows()) names.add(workflow.name);
  return [...names].sort();
}

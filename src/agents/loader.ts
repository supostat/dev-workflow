import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../lib/frontmatter.js";
import type { AgentDefinition, AgentPermissions, GitOperation, VaultSection } from "./types.js";

const VALID_VAULT_SECTIONS: ReadonlySet<string> = new Set([
  "stack", "conventions", "knowledge", "gameplan", "branch", "dailyLogs",
]);

const VALID_GIT_OPERATIONS: ReadonlySet<string> = new Set([
  "add", "commit", "status", "diff",
]);

function toStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (value === "") return [];
  return [value];
}

function stripQuotes(value: string): string {
  const match = value.match(/^(["'])(.*)(\1)$/);
  return match ? match[2]! : value;
}

export function parseAgentFile(filepath: string): AgentDefinition {
  const raw = readFileSync(filepath, "utf-8");
  const { fields, body } = parseFrontmatter(raw);

  const name = fields["name"];
  if (!name || typeof name !== "string") {
    throw new Error(`Agent file missing 'name' field: ${filepath}`);
  }

  const description = typeof fields["description"] === "string"
    ? fields["description"]
    : "";

  const vaultRaw = toStringArray(fields["vault"]);
  const vaultSections = vaultRaw.filter((section) =>
    VALID_VAULT_SECTIONS.has(section),
  ) as VaultSection[];

  const writePatterns = toStringArray(fields["write"]).map(stripQuotes);
  const shellCommands = toStringArray(fields["shell"]).map(stripQuotes);

  const gitOperations = toStringArray(fields["git"])
    .filter((operation) => VALID_GIT_OPERATIONS.has(operation)) as GitOperation[];

  const readField = fields["read"];
  const readFiles = readField === "false" ? false : true;

  const permissions: AgentPermissions = {
    readFiles,
    writePatterns,
    gitOperations,
    shellCommands,
  };

  return {
    name,
    description,
    systemPrompt: body,
    vaultSections,
    permissions,
  };
}

export type VaultSection =
  | "stack"
  | "conventions"
  | "knowledge"
  | "gameplan"
  | "branch"
  | "dailyLogs"
  | "engram";

export type GitOperation = "add" | "commit" | "status" | "diff";

export interface AgentPermissions {
  readFiles: boolean;
  writePatterns: string[];
  gitOperations: GitOperation[];
  shellCommands: string[];
}

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  vaultSections: VaultSection[];
  permissions: AgentPermissions;
}

export interface PreparedAgent {
  definition: AgentDefinition;
  resolvedPrompt: string;
}

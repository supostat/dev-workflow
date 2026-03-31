export interface ProjectContext {
  projectName: string;
  branch: string;
  parentBranch: string;
  vaultPath: string;
  projectRoot: string;
  gitRemote: string | null;
}

export interface VaultData {
  stack: string | null;
  conventions: string | null;
  knowledge: string | null;
  gameplan: string | null;
  branch: BranchContext | null;
  recentDailyLogs: DailyLog[];
}

export interface BranchContext {
  raw: string;
  branch: string;
  status: "in-progress" | "on-hold" | "merged" | "abandoned";
  created: string;
  parent: string;
}

export interface DailyLog {
  date: string;
  filename: string;
  content: string;
}

export interface RecordOptions {
  type: "adr" | "bug" | "debt" | "deploy" | "branch" | "daily";
  title: string;
  date: string;
  extra: Record<string, string>;
}

export interface InitOptions {
  projectRoot: string;
  force: boolean;
}

export interface HookOutput {
  status: "ok" | "error";
  message: string;
  context?: VaultData;
}

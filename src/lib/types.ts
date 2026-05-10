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

// Communication profile configuration (ADR 2026-05-10)

export type ToneType = "friendly" | "terse" | "formal";
export type VerbosityType = "brief" | "detailed" | "structured";
export type ExpertiseType = "junior" | "senior";
export type LanguageType = "ru" | "en" | "auto";
export type OutputType = "code_first" | "with_alternatives" | "review_template";

export interface CommunicationProfile {
  language: LanguageType;
  tone?: ToneType;
  verbosity?: VerbosityType;
  expertise?: ExpertiseType;
  output?: OutputType;
  explanations?: OutputType;
  ask_before_acting?: boolean;
  output_format?: string;
  emojis?: boolean;
  severity_levels?: string[];
  fallback_language?: LanguageType;
  code_comments?: LanguageType;
  commit_messages?: LanguageType;
  docs_language?: LanguageType;
  session_logs?: LanguageType;
}

export interface CommunicationConfig {
  active_profile: string;
  profiles: {
    [name: string]: CommunicationProfile;
  };
}
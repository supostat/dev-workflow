export type PatternCategory = "file" | "convention" | "pattern" | "gotcha" | "decision" | "task" | "session";

export type EdgeRelation = "related" | "depends" | "conflicts" | "part-of" | "co-edited";

export interface PatternNode {
  id: string;
  category: PatternCategory;
  content: string;
  source: string;
  confidence: number;
  accessCount: number;
  lastAccessed: string;
  createdAt: string;
}

export interface PatternEdge {
  from: string;
  to: string;
  relation: EdgeRelation;
  weight: number;
}

export interface IntelligenceGraph {
  version: 1;
  updatedAt: string;
  nodes: Record<string, PatternNode>;
  edges: PatternEdge[];
}

export interface ScoringContext {
  branch: string;
  taskTitle: string | null;
  recentFiles: string[];
  query: string | null;
}

export interface ScoredNode {
  node: PatternNode;
  score: number;
}

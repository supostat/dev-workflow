import type { PatternNode, ScoringContext, ScoredNode } from "./types.js";

const DAY_MS = 86_400_000;
const RECENCY_HALF_LIFE_DAYS = 7;

function recencyScore(lastAccessed: string): number {
  const ageMs = Date.now() - new Date(lastAccessed).getTime();
  const ageDays = ageMs / DAY_MS;
  return Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
}

function frequencyScore(accessCount: number, maxAccess: number): number {
  if (maxAccess === 0) return 0;
  return accessCount / maxAccess;
}

function contextMatchScore(node: PatternNode, context: ScoringContext): number {
  const contentLower = node.content.toLowerCase();
  let matches = 0;
  let checks = 0;

  if (context.branch) {
    checks++;
    const branchWords = context.branch.toLowerCase().replace(/[/_-]/g, " ").split(" ");
    for (const word of branchWords) {
      if (word.length > 2 && contentLower.includes(word)) {
        matches++;
        break;
      }
    }
  }

  if (context.taskTitle) {
    checks++;
    const taskWords = context.taskTitle.toLowerCase().split(/\s+/);
    for (const word of taskWords) {
      if (word.length > 2 && contentLower.includes(word)) {
        matches++;
        break;
      }
    }
  }

  if (context.recentFiles.length > 0) {
    checks++;
    for (const file of context.recentFiles) {
      const fileName = file.split("/").pop()?.replace(/\.\w+$/, "").toLowerCase() ?? "";
      if (fileName.length > 2 && contentLower.includes(fileName)) {
        matches++;
        break;
      }
    }
  }

  if (context.query) {
    checks++;
    const queryWords = context.query.toLowerCase().split(/\s+/);
    for (const word of queryWords) {
      if (word.length > 2 && contentLower.includes(word)) {
        matches++;
        break;
      }
    }
  }

  return checks === 0 ? 0 : matches / checks;
}

export function scoreNodes(nodes: PatternNode[], context: ScoringContext): ScoredNode[] {
  const maxAccess = Math.max(1, ...nodes.map((n) => n.accessCount));

  return nodes.map((node) => {
    const confidence = node.confidence * 0.3;
    const recency = recencyScore(node.lastAccessed) * 0.3;
    const frequency = frequencyScore(node.accessCount, maxAccess) * 0.2;
    const contextMatch = contextMatchScore(node, context) * 0.2;

    return {
      node,
      score: confidence + recency + frequency + contextMatch,
    };
  });
}

export function topN(nodes: PatternNode[], context: ScoringContext, count: number = 20): ScoredNode[] {
  return scoreNodes(nodes, context)
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

export function formatRelevantContext(scored: ScoredNode[]): string {
  if (scored.length === 0) return "";

  const lines: string[] = ["## Relevant Context (auto-ranked)"];

  const grouped: Record<string, ScoredNode[]> = {};
  for (const item of scored) {
    const cat = item.node.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat]!.push(item);
  }

  const categoryLabels: Record<string, string> = {
    convention: "Conventions",
    pattern: "Patterns",
    gotcha: "Gotchas",
    decision: "Decisions",
    file: "Recent files",
    task: "Tasks",
    session: "Sessions",
  };

  for (const [category, items] of Object.entries(grouped)) {
    const label = categoryLabels[category] ?? category;
    lines.push(`\n### ${label}`);
    for (const item of items.slice(0, 5)) {
      const score = (item.score * 100).toFixed(0);
      lines.push(`- ${item.node.content} (${score}%)`);
    }
  }

  return lines.join("\n");
}

import type { EngramHealthStatus } from "../lib/engram.js";

export function formatEngramHealthWarning(
  health: EngramHealthStatus | null,
  pendingThreshold: number,
): string | null {
  if (!health) return null;
  const reasons: string[] = [];
  if (health.pendingJudgments > pendingThreshold) {
    reasons.push(`${health.pendingJudgments} pending judgments`);
  }
  if (health.modelsStale) {
    reasons.push("models stale");
  }
  if (reasons.length === 0) return null;
  return `\n> **⚠️ Engram:** ${reasons.join(", ")}. Run \`engram train\`.`;
}

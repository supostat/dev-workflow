export interface EngramFeedbackJudgment {
  score: number;
  explanation: string;
}

export interface EngramFeedbackResult {
  judgments: Map<string, EngramFeedbackJudgment>;
  fallbackIds: string[];
}

interface SectionSplit {
  bodyForGate: string;
  feedbackSection: string | null;
}

const HEADING_REGEX = /^##\s+Engram Feedback\s*$/im;
const NEXT_HEADING_REGEX = /^##\s+\S/m;
// The leading `-` list marker and the `memory:` id prefix are both optional —
// orchestrators emit any of: `<id>: …`, `- <id>: …`, `memory:<id>: …`,
// `- memory:<id>: …`. All four forms parse to the same id/score/explanation.
const LINE_REGEX = /^\s*-?\s*(?:memory:)?([^\s:]+)\s*:\s*([+\-]?\d+(?:\.\d+)?)\s*[—–-]\s?(.*)$/;

export function extractEngramFeedbackSection(output: string): SectionSplit {
  const headingMatch = HEADING_REGEX.exec(output);
  if (!headingMatch) {
    return { bodyForGate: output, feedbackSection: null };
  }

  const headingStart = headingMatch.index;
  const afterHeading = headingStart + headingMatch[0].length;
  const sectionTail = output.slice(afterHeading);

  const nextHeadingMatch = NEXT_HEADING_REGEX.exec(sectionTail);
  const sectionEndInTail = nextHeadingMatch ? nextHeadingMatch.index : sectionTail.length;
  const feedbackSection = sectionTail
    .slice(0, sectionEndInTail)
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");

  return {
    bodyForGate: output.slice(0, headingStart),
    feedbackSection,
  };
}

export function parseEngramFeedback(
  output: string,
  expectedMemoryIds: readonly string[],
): EngramFeedbackResult {
  const judgments = new Map<string, EngramFeedbackJudgment>();
  const expectedSet = new Set(expectedMemoryIds);

  const { feedbackSection } = extractEngramFeedbackSection(output);
  if (feedbackSection !== null && feedbackSection.length > 0) {
    for (const rawLine of feedbackSection.split("\n")) {
      const parsed = parseOneLine(rawLine);
      if (!parsed) continue;
      if (!expectedSet.has(parsed.id)) continue;
      if (judgments.has(parsed.id)) continue;
      judgments.set(parsed.id, { score: parsed.score, explanation: parsed.explanation });
    }
  }

  const fallbackIds = expectedMemoryIds.filter((id) => !judgments.has(id));
  return { judgments, fallbackIds };
}

function parseOneLine(
  line: string,
): { id: string; score: number; explanation: string } | null {
  const match = LINE_REGEX.exec(line);
  if (!match) return null;

  const id = match[1]!;
  const scoreRaw = Number.parseFloat(match[2]!);
  if (!Number.isFinite(scoreRaw) || scoreRaw < 0 || scoreRaw > 1) {
    return null;
  }

  const explanation = match[3]!.trim();
  return { id, score: scoreRaw, explanation };
}

export type JudgeFn = (memoryId: string, score: number, explanation: string) => Promise<unknown> | unknown;

const JUDGE_CAP = 20;

export async function applyEngramJudgments(
  judge: JudgeFn,
  feedbackResult: EngramFeedbackResult,
  fallbackScore: number,
  stepName: string,
  status: "completed" | "failed",
): Promise<void> {
  if (feedbackResult.judgments.size === 0 && feedbackResult.fallbackIds.length === 0) {
    return;
  }

  const fallbackExplanation = status === "completed"
    ? `Memories retrieved before step [${stepName}] which completed successfully (no agent feedback)`
    : `Memories retrieved before step [${stepName}] which failed gate check (no agent feedback)`;

  let budget = JUDGE_CAP;

  for (const [id, judgment] of feedbackResult.judgments.entries()) {
    if (budget-- <= 0) break;
    await judge(id, judgment.score, judgment.explanation);
  }
  for (const id of feedbackResult.fallbackIds) {
    if (budget-- <= 0) break;
    await judge(id, fallbackScore, fallbackExplanation);
  }

  if (feedbackResult.judgments.size === 0 && feedbackResult.fallbackIds.length > 0) {
    process.stderr.write(
      `[engram] feedback section missing for step [${stepName}], applied blanket ${fallbackScore} to ${feedbackResult.fallbackIds.length} memories\n`,
    );
  }
}

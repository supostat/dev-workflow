export type SpecSectionName = "stack" | "conventions" | "knowledge" | "gameplan";

export interface SpecSections {
  stack: string | null;
  conventions: string | null;
  knowledge: string | null;
  gameplan: string | null;
}

const SECTION_HEADINGS: Record<string, SpecSectionName> = {
  Stack: "stack",
  Conventions: "conventions",
  Knowledge: "knowledge",
  Gameplan: "gameplan",
};

/**
 * Deterministic 4-section parser for SPEC.md mirror skeleton.
 *
 * Recognised top-level headings (first word, case-insensitive): Stack | Conventions | Knowledge | Gameplan.
 * Suffixes after em-dash, hyphen, or paren are accepted and ignored, e.g.
 *   "# Stack — Backend Platform"
 *   "# Conventions (v2)"
 *   "# Knowledge - notes"
 *
 * Sub-headings ("## ...") are preserved verbatim inside the parent section.
 * Unknown top-level headings (e.g. "# Bootstrap") close the prior section but
 * do NOT open a new one — their content is discarded until the next recognised
 * heading or end of file.
 *
 * Missing sections remain `null` (NOT thrown).
 */
export function parseSpecSections(content: string): SpecSections {
  const result: SpecSections = {
    stack: null,
    conventions: null,
    knowledge: null,
    gameplan: null,
  };
  const lines = content.split("\n");
  let currentSection: SpecSectionName | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (currentSection !== null) {
      result[currentSection] = buffer.join("\n").trimEnd();
    }
  };

  for (const line of lines) {
    // Match top-level heading; capture leading word(s), allow optional
    // suffix after em-dash, hyphen, or paren.
    const match = /^# ([A-Za-z][A-Za-z\s—\-]*?)\s*(?:[—\-(].*)?$/.exec(line);
    if (match) {
      const headingFirstWord = match[1]!.trim().split(/\s+/)[0]!;
      const canonical = Object.keys(SECTION_HEADINGS).find(
        (k) => k.toLowerCase() === headingFirstWord.toLowerCase(),
      );
      flush();
      currentSection = canonical ? SECTION_HEADINGS[canonical]! : null;
      buffer = [];
      continue;
    }
    if (currentSection !== null) {
      buffer.push(line);
    }
  }
  flush();
  return result;
}

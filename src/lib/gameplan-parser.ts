import { parseFrontmatter } from "./frontmatter.js";

/**
 * Phase-name shape validation — same character set as workflow names
 * (`[a-z0-9][a-z0-9-]{0,63}`). Lowercase kebab-case, 1-64 chars, starts with
 * `[a-z0-9]`. Applied as defense-in-depth at the parser boundary regardless
 * of whether the value originated from frontmatter or the body regex.
 */
export const VALID_PHASE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Body fallback: matches the gameplan `## Current Phase` marker line
 *   `**Active: \`<phase-name>\`**`
 * Capture group is pre-validated by the regex itself (same character set as
 * {@link VALID_PHASE_NAME_PATTERN}). The post-regex
 * {@link VALID_PHASE_NAME_PATTERN}.test() call is still applied as
 * defense-in-depth so the validation invariant holds even if this pattern
 * is later relaxed.
 */
export const GAMEPLAN_PHASE_PATTERN =
  /\*\*Active:\s*`([a-z0-9][a-z0-9-]{0,63})`\*\*/;

/**
 * Extract the active gameplan phase name from `gameplan.md` content.
 *
 * Hybrid priority (A + B):
 *   1. Frontmatter field `current-phase` (string scalar only). YAML arrays
 *      and non-string types are rejected by the `typeof === "string"` guard.
 *      Empty string maps to `null`.
 *   2. Body regex {@link GAMEPLAN_PHASE_PATTERN} as fallback.
 *
 * Either source is validated against {@link VALID_PHASE_NAME_PATTERN};
 * failure → `null`. Never throws — caller can assume a total function on
 * arbitrary string input.
 */
export function parseGameplanPhase(content: string): string | null {
  const { fields, body } = parseFrontmatter(content);

  const frontmatterPhase = fields["current-phase"];
  if (typeof frontmatterPhase === "string") {
    if (frontmatterPhase.length === 0) return null;
    return VALID_PHASE_NAME_PATTERN.test(frontmatterPhase) ? frontmatterPhase : null;
  }

  // Frontmatter field present but not a string (e.g. YAML array `[x]`) →
  // do NOT fall through to the body regex. The presence of the key signals
  // explicit intent; the parser must not silently override a malformed
  // declaration with body content.
  if (frontmatterPhase !== undefined) return null;

  const match = body.match(GAMEPLAN_PHASE_PATTERN);
  if (!match?.[1]) return null;
  const candidate = match[1];
  return VALID_PHASE_NAME_PATTERN.test(candidate) ? candidate : null;
}

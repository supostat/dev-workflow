import { randomBytes } from "node:crypto";

/**
 * Maximum length of a single user-supplied input value before truncation.
 * 10000 chars ≈ 2500-3000 tokens — enough for any reasonable task description,
 * bounded enough to prevent token exhaustion / DoS via 10MB pasted blob.
 */
export const MAX_USER_INPUT_LEN = 10000;

/**
 * Matches any `<<<LABEL[:anyid]>>>` / `<<<END_LABEL[:anyid]>>>` markers that
 * look like our own fence syntax. Permissive on the id suffix — accepts ANY
 * non-`>` characters — because the threat is an attacker forging markers with
 * arbitrary id strings, not us validating our own format. Used to strip
 * injection attempts from the value before wrapping; the marker is replaced
 * with a visible placeholder so the LLM sees the tampering attempt.
 */
const SELF_FENCE_PATTERN = /<<<(?:END_)?[A-Z_]+(?::[^>\s]+)?>>>/g;

/**
 * Wrap a single user-supplied value in a uniquely-fenced block so downstream
 * consumers (agents, LLMs) can distinguish unescaped user content from
 * orchestrator instructions.
 *
 * Defense properties (closes debt 2026-04-09 prompt-interpolation no-escaping):
 *
 * 1. **Fence opacity** — fence id is `randomBytes(8).toString("hex")` per call.
 *    An attacker who doesn't know the runtime id cannot forge a matching
 *    `<<<END_X>>>` to "break out" of the user-input section.
 * 2. **Marker scrubbing** — any existing `<<<LABEL:id>>>`-shaped markers in
 *    the input are stripped to `[fence-marker-stripped]` BEFORE wrapping. So
 *    even if the attacker guessed our format, their injected markers don't
 *    survive to the LLM's eyes.
 * 3. **Length cap** — values exceeding {@link MAX_USER_INPUT_LEN} are
 *    truncated with a visible `[truncated: was N chars]` suffix. Prevents
 *    token exhaustion / DoS from oversized inputs.
 *
 * Apply at every system boundary where user-controlled text enters a prompt
 * (taskDescription from CLI, --file contents, free-form intake input).
 */
export function escapeUserInput(value: string, label = "USER_INPUT"): string {
  const scrubbed = value.replace(SELF_FENCE_PATTERN, "[fence-marker-stripped]");

  const truncated = scrubbed.length > MAX_USER_INPUT_LEN
    ? scrubbed.slice(0, MAX_USER_INPUT_LEN)
      + `\n[truncated: was ${scrubbed.length} chars, kept first ${MAX_USER_INPUT_LEN}]`
    : scrubbed;

  const fenceId = randomBytes(8).toString("hex");
  return `<<<${label}:${fenceId}>>>\n${truncated}\n<<<END_${label}:${fenceId}>>>`;
}

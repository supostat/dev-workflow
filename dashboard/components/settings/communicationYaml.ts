// Pure communication.yaml form model + serializer for the Settings page.
//
// No React, no hooks. `CommunicationForm` describes one editable profile; the
// zod schema validates it against the SAME enum sets the core parser accepts
// (src/lib/communication.ts). `serializeCommunicationYaml` emits the 2/4-space
// indented document the server-side parser round-trips: an `active_profile:`
// line, a `profiles:` header, one `  <name>:` block per profile, and
// `    field: value` lines for every defined field. Undefined fields are
// omitted; booleans render as the bare literals `true` / `false`.

import { z } from "zod";

/** Language-family enum — `language` and the five language-scoped fields. */
export const LANGUAGE_VALUES = ["ru", "en", "auto"] as const;
/** Tone enum — accepted `tone` values. */
export const TONE_VALUES = ["friendly", "terse", "formal"] as const;
/** Verbosity enum — accepted `verbosity` values. */
export const VERBOSITY_VALUES = ["brief", "detailed", "structured"] as const;
/** Expertise enum — the core validator allows `junior` / `senior` only (no `mid`). */
export const EXPERTISE_VALUES = ["junior", "senior"] as const;
/** Output-style enum — shared by the `output` and `explanations` fields. */
export const OUTPUT_VALUES = ["code_first", "with_alternatives", "review_template"] as const;

const languageEnum = z.enum(LANGUAGE_VALUES);

/** Zod schema for one editable communication profile. `language` is required. */
export const communicationFormSchema = z.object({
  language: languageEnum,
  fallback_language: languageEnum.optional(),
  code_comments: languageEnum.optional(),
  commit_messages: languageEnum.optional(),
  docs_language: languageEnum.optional(),
  session_logs: languageEnum.optional(),
  tone: z.enum(TONE_VALUES).optional(),
  verbosity: z.enum(VERBOSITY_VALUES).optional(),
  expertise: z.enum(EXPERTISE_VALUES).optional(),
  output: z.enum(OUTPUT_VALUES).optional(),
  explanations: z.enum(OUTPUT_VALUES).optional(),
  ask_before_acting: z.boolean().optional(),
  emojis: z.boolean().optional(),
});

/** Validated single-profile communication form values. */
export type CommunicationForm = z.infer<typeof communicationFormSchema>;

/** Field render order in the serialized YAML — language first, flags last. */
const FIELD_ORDER: readonly (keyof CommunicationForm)[] = [
  "language",
  "fallback_language",
  "code_comments",
  "commit_messages",
  "docs_language",
  "session_logs",
  "tone",
  "verbosity",
  "expertise",
  "output",
  "explanations",
  "ask_before_acting",
  "emojis",
];

/** Render one field value as its YAML scalar — bare boolean or plain string. */
function renderValue(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : value;
}

/** Emit the `    field: value` lines for one profile, omitting undefined fields. */
function serializeProfileFields(profile: CommunicationForm): string[] {
  const lines: string[] = [];
  for (const field of FIELD_ORDER) {
    const value = profile[field];
    if (value === undefined) continue;
    lines.push(`    ${field}: ${renderValue(value)}`);
  }
  return lines;
}

/**
 * Serialize the active profile name and the profile map to a communication.yaml
 * document. Indentation is 0 for the two headers, 2 for each profile name, and
 * 4 for each field — the exact shape the core parser accepts.
 */
export function serializeCommunicationYaml(
  activeProfile: string,
  profiles: Record<string, CommunicationForm>,
): string {
  const lines: string[] = [`active_profile: ${activeProfile}`, "profiles:"];
  for (const [name, profile] of Object.entries(profiles)) {
    lines.push(`  ${name}:`);
    lines.push(...serializeProfileFields(profile));
  }
  return `${lines.join("\n")}\n`;
}

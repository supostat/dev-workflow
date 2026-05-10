import { loadCommunicationConfig } from "../lib/communication.js";
import { getActiveProfile } from "../lib/communication-state.js";
import type { CommunicationProfile } from "../lib/types.js";

/**
 * Build a session-start additionalContext block describing the active
 * communication profile. Pure function — read-only, returns null when
 * communication.yaml is absent (backwards-compat: no block emitted).
 *
 * Behavior matrix:
 * - communication.yaml missing                 → null (silent, no block)
 * - communication.yaml malformed (parse error) → null (silent, fail-safe)
 * - effective profile not in profiles map      → warning block flagging drift
 * - effective profile resolves                 → "🎙️ Active profile" block with key fields
 *
 * Effective profile resolution: state file (.profile-state via getActiveProfile)
 * takes precedence over the static `active_profile` field in YAML.
 */
export function formatActiveProfileBlock(vaultPath: string): string | null {
  let config;
  try {
    config = loadCommunicationConfig(vaultPath);
  } catch {
    // Malformed yaml: session-start must not fail. Detailed errors surface
    // via `dev-workflow communication-template` or `/profile` direct calls.
    return null;
  }
  if (config === null) return null;

  const stateActive = safeGetActiveProfile(vaultPath);
  const effective = stateActive ?? config.active_profile;
  const source = stateActive !== null ? "state" : "yaml-default";
  const profile = config.profiles[effective];

  if (!profile) {
    return `\n⚠️  Active profile '${effective}' (from ${source}) not found in communication.yaml profiles map. Run \`/profile\` to pick a valid one.`;
  }

  return formatBlock(effective, profile, source);
}

function safeGetActiveProfile(vaultPath: string): string | null {
  try {
    return getActiveProfile(vaultPath);
  } catch {
    // getActiveProfile is itself fail-safe (returns null on read error), but
    // belt-and-suspenders: hook never propagates exceptions.
    return null;
  }
}

function formatBlock(name: string, profile: CommunicationProfile, source: string): string {
  const fields: string[] = [`language=${profile.language}`];
  if (profile.tone) fields.push(`tone=${profile.tone}`);
  if (profile.verbosity) fields.push(`verbosity=${profile.verbosity}`);
  if (profile.expertise) fields.push(`expertise=${profile.expertise}`);
  if (profile.output) fields.push(`output=${profile.output}`);

  return `\n🎙️  Active profile: **${name}** (${source}) — ${fields.join(", ")}`;
}

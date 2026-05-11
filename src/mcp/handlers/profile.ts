import { loadCommunicationConfig } from "../../lib/communication.js";
import { getActiveProfile, setActiveProfile, clearActiveProfile } from "../../lib/communication-state.js";
import type { CommunicationProfile } from "../../lib/types.js";

export function profileGet(vaultPath: string): unknown {
  const config = loadCommunicationConfig(vaultPath);
  if (config === null) {
    return { configured: false, active: null, default: null, available: [], config: null };
  }
  const stateActive = getActiveProfile(vaultPath);
  const effective = stateActive ?? config.active_profile;
  const profile: CommunicationProfile | null = config.profiles[effective] ?? null;
  return {
    configured: true,
    active: stateActive,
    default: config.active_profile,
    effective,
    available: Object.keys(config.profiles).sort(),
    config: profile,
  };
}

export function profileSet(vaultPath: string, name: string): unknown {
  const config = loadCommunicationConfig(vaultPath);
  if (config === null) {
    throw new Error(`profile_set: communication.yaml not found in ${vaultPath}`);
  }
  if (!Object.prototype.hasOwnProperty.call(config.profiles, name)) {
    const available = Object.keys(config.profiles).sort().join(", ");
    throw new Error(`profile_set: unknown profile '${name}' — available: ${available}`);
  }
  setActiveProfile(vaultPath, name);
  return {
    ok: true,
    active: name,
    config: config.profiles[name],
  };
}

export function profileClear(vaultPath: string): unknown {
  clearActiveProfile(vaultPath);
  return { ok: true };
}

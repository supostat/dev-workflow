import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Merge dev-workflow's hooks/permissions/statusLine into a project's
 * `.claude/settings.json`, preserving any unrelated user keys.
 *
 *  - `hooks`: per-event, configs whose `hooks` payload matches an incoming
 *    config are replaced; all other existing configs are kept and the new
 *    configs appended. This keeps the dev-workflow hooks current without
 *    duplicating them on re-runs.
 *  - `permissions`: `allow`/`deny` lists are set-unioned.
 *  - `statusLine`: overwritten with the dev-workflow value.
 *
 * A missing or malformed existing file is treated as an empty object — the
 * merge then writes a fresh settings.json. Creates the parent directory.
 */
export function mergeSettingsJson(filepath: string, newSettings: Record<string, unknown>): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(filepath)) {
    try {
      existing = JSON.parse(readFileSync(filepath, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const existingHooks = (existing["hooks"] ?? {}) as Record<string, unknown[]>;
  const newHooks = (newSettings["hooks"] ?? {}) as Record<string, unknown[]>;
  const mergedHooks = { ...existingHooks };
  for (const [event, configs] of Object.entries(newHooks)) {
    const existingConfigs = mergedHooks[event] ?? [];
    const newCommands = new Set(
      configs.map((c) => JSON.stringify((c as Record<string, unknown>)["hooks"] ?? c)),
    );
    const filtered = existingConfigs.filter(
      (c) => !newCommands.has(JSON.stringify((c as Record<string, unknown>)["hooks"] ?? c)),
    );
    mergedHooks[event] = [...filtered, ...configs];
  }

  const existingPerms = (existing["permissions"] ?? {}) as Record<string, unknown>;
  const newPerms = (newSettings["permissions"] ?? {}) as Record<string, unknown>;
  const existingAllow = (existingPerms["allow"] ?? []) as string[];
  const newAllow = (newPerms["allow"] ?? []) as string[];
  const existingDeny = (existingPerms["deny"] ?? []) as string[];
  const newDeny = (newPerms["deny"] ?? []) as string[];
  const mergedPerms = {
    allow: [...new Set([...existingAllow, ...newAllow])],
    deny: [...new Set([...existingDeny, ...newDeny])],
  };

  const merged = {
    ...existing,
    hooks: mergedHooks,
    permissions: mergedPerms,
    statusLine: newSettings["statusLine"],
  };

  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(merged, null, 2), "utf-8");
}

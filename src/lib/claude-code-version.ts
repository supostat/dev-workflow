import { execFileSync } from "node:child_process";

/**
 * Minimum Claude Code version required for skills format support.
 * Claude Code v2.1.101 (April 2026) introduced `.claude/skills/<name>/SKILL.md`
 * directory layout that dev-workflow now uses for slash commands.
 */
export const MIN_CLAUDE_CODE_VERSION = "2.1.101";

/**
 * Executor abstraction so tests can inject a fake without spawning a real
 * process. Production calls `defaultExecutor` which spawns `claude --version`.
 */
export type VersionExecutor = () => string;

const defaultExecutor: VersionExecutor = () =>
  execFileSync("claude", ["--version"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
  });

/**
 * Detect installed Claude Code version by spawning `claude --version`.
 *
 * Returns the parsed semver string (e.g. `"2.1.101"`) on success.
 * Returns `null` when the binary is missing, the command fails, or the
 * output does not contain a recognisable `N.N.N` prefix — caller decides
 * whether to treat null as advisory (init) or as an issue (doctor).
 *
 * The expected output format is `"2.1.101 (Claude Code)"` but only the
 * leading semver triple is required; trailing text is ignored.
 */
export function getClaudeCodeVersion(executor: VersionExecutor = defaultExecutor): string | null {
  let output: string;
  try {
    output = executor();
  } catch {
    return null;
  }
  const match = output.match(/^(\d+\.\d+\.\d+)/);
  return match ? match[1]! : null;
}

/**
 * Compare two semver strings of the form `N.N.N`. Returns -1 if `a < b`,
 * 0 if equal, 1 if `a > b`. Numeric segment compare (not lexicographic),
 * so `1.2.10 > 1.2.9` evaluates correctly.
 *
 * Missing segments are treated as zero (`1.2` is `1.2.0`). Non-numeric
 * segments are coerced to NaN which compares as 0 — sufficient for our
 * Claude Code release versions which are always three numeric segments.
 */
export function compareVersions(a: string, b: string): number {
  const segmentsA = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const segmentsB = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const maxLength = Math.max(segmentsA.length, segmentsB.length);
  for (let i = 0; i < maxLength; i++) {
    const numA = segmentsA[i] ?? 0;
    const numB = segmentsB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

export type RequireVersionStatus = "ok" | "too-old" | "not-detected";

export interface RequireVersionResult {
  ok: boolean;
  detected: string | null;
  minimum: string;
  status: RequireVersionStatus;
}

/**
 * Structured version-check result for callers (init refuses on too-old,
 * doctor reports all three statuses). Contract:
 *
 *  - `ok: true,  detected: "X.Y.Z", status: "ok"`           — version >= min
 *  - `ok: false, detected: "X.Y.Z", status: "too-old"`      — REFUSE (init exits 1)
 *  - `ok: true,  detected: null,    status: "not-detected"` — advisory, PROCEED
 *
 * "not-detected" is `ok: true` deliberately — CI environments may install
 * dev-workflow without Claude Code present, and we don't want to break
 * those flows. Doctor still pushes a note to the issues list.
 */
export function requireClaudeCodeVersion(
  min: string = MIN_CLAUDE_CODE_VERSION,
  executor: VersionExecutor = defaultExecutor,
): RequireVersionResult {
  const detected = getClaudeCodeVersion(executor);
  if (detected === null) {
    return { ok: true, detected: null, minimum: min, status: "not-detected" };
  }
  if (compareVersions(detected, min) >= 0) {
    return { ok: true, detected, minimum: min, status: "ok" };
  }
  return { ok: false, detected, minimum: min, status: "too-old" };
}

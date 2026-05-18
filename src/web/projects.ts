// Multi-project registry: reads/writes `~/.config/dev-workflow/projects.json`
// (XDG Base Directory compliant). The web server (task-055) calls this to
// resolve the active project before dispatching API requests.
//
// Hardening notes:
//  - loadRegistry NEVER throws — a missing, malformed, or hostile registry
//    file degrades to an empty registry so the server still starts.
//  - The parser uses Object.create(null) accumulators and a RESERVED_KEYS
//    whitelist to defend against prototype-pollution via crafted JSON keys
//    (mirrors src/lib/communication.ts and src/lib/frontmatter.ts).
//  - saveRegistry writes atomically via a temp file + renameSync so a
//    crashed write never leaves a torn registry on disk.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { readFileOrNull, slugify } from "../lib/fs-helpers.js";
import type { Project, ProjectRegistry } from "./types.js";

/**
 * Project-name grammar: alphanumeric start, then alphanumeric / dash / dot /
 * underscore, length 1–80, no path separators. Mirrors the snapshot-name
 * pattern shape. Path separators and leading dots are rejected so a registry
 * key can never escape its directory or shadow a dotfile.
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

/**
 * JavaScript identifiers that mutate the prototype chain when used as object
 * keys. Rejected as registry keys at parse time — defense-in-depth alongside
 * the Object.create(null) accumulator and the hasOwnProperty whitelist check.
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const REGISTRY_DIRNAME = "dev-workflow";
const REGISTRY_FILENAME = "projects.json";
const TEMP_SUFFIX = ".tmp";

/**
 * Validate a project name against {@link NAME_PATTERN}.
 *
 * Returns a boolean (per task-054 spec) rather than throwing — this diverges
 * deliberately from the throwing `validateSnapshotName` so callers can use it
 * as a filter predicate while parsing an untrusted registry.
 */
export function validateProjectName(name: string): boolean {
  if (RESERVED_KEYS.has(name)) return false;
  return NAME_PATTERN.test(name);
}

/**
 * Resolve the registry file path on every call (not a module-level const) so
 * a changed `XDG_CONFIG_HOME` between calls — and test overrides — take
 * effect. Falls back to `~/.config` when the env var is unset.
 */
function registryPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(configHome, REGISTRY_DIRNAME, REGISTRY_FILENAME);
}

/** Shape-validate one registry entry, returning a clean Project or null. */
function normalizeProjectEntry(name: string, entry: unknown): Project | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const path = record["path"];
  if (typeof path !== "string" || path.length === 0) return null;
  const lastSeen = typeof record["lastSeen"] === "string" ? record["lastSeen"] : "";
  return { name, path, lastSeen };
}

/**
 * Convert an untrusted parsed JSON value into a safe {@link ProjectRegistry}.
 * Hostile keys, malformed entries, and dangling `activeProject` references are
 * dropped silently.
 */
function sanitizeRegistry(raw: unknown): ProjectRegistry {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { projects: {}, activeProject: null };
  }
  const projectsRaw = (raw as Record<string, unknown>)["projects"];
  const projects: Record<string, Project> = Object.create(null);
  if (projectsRaw !== null && typeof projectsRaw === "object" && !Array.isArray(projectsRaw)) {
    for (const name of Object.keys(projectsRaw)) {
      if (RESERVED_KEYS.has(name)) continue;
      if (!Object.prototype.hasOwnProperty.call(projectsRaw, name)) continue;
      if (!validateProjectName(name)) continue;
      const normalized = normalizeProjectEntry(name, (projectsRaw as Record<string, unknown>)[name]);
      if (normalized !== null) projects[name] = normalized;
    }
  }
  const activeRaw = (raw as Record<string, unknown>)["activeProject"];
  const activeProject =
    typeof activeRaw === "string" && Object.prototype.hasOwnProperty.call(projects, activeRaw)
      ? activeRaw
      : null;
  return { projects, activeProject };
}

/**
 * Load the project registry. Never throws: a missing file, malformed JSON, or
 * a hostile document all degrade to an empty registry.
 */
export function loadRegistry(): ProjectRegistry {
  const content = readFileOrNull(registryPath());
  if (content === null) return { projects: {}, activeProject: null };
  try {
    return sanitizeRegistry(JSON.parse(content));
  } catch {
    return { projects: {}, activeProject: null };
  }
}

/**
 * Persist the registry atomically: write a sibling `.tmp` file, then rename it
 * over the target. The rename is atomic on POSIX, so a reader never observes a
 * partially written registry.
 */
export function saveRegistry(registry: ProjectRegistry): void {
  const target = registryPath();
  mkdirSync(join(target, ".."), { recursive: true });
  const tempPath = target + TEMP_SUFFIX;
  writeFileSync(tempPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  renameSync(tempPath, target);
}

/**
 * Register `cwd` as a project, returning the stored entry. Idempotent: an
 * already-registered path keeps its name and only refreshes `lastSeen`. The
 * project name is the slugified basename of `cwd`; throws if that cannot
 * produce a valid name or if `cwd` is not absolute.
 */
export function addProject(cwd: string): Project {
  if (!isAbsolute(cwd)) {
    throw new Error(`Project path must be absolute: "${cwd}"`);
  }
  const registry = loadRegistry();

  const existing = Object.values(registry.projects).find((project) => project.path === cwd);
  const nowIso = new Date().toISOString();
  if (existing) {
    const refreshed: Project = { ...existing, lastSeen: nowIso };
    registry.projects[existing.name] = refreshed;
    saveRegistry(registry);
    return refreshed;
  }

  const name = slugify(basename(cwd)).toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^[-.]+/, "");
  if (!validateProjectName(name)) {
    throw new Error(`Cannot derive a valid project name from "${cwd}" (got "${name}").`);
  }
  if (Object.prototype.hasOwnProperty.call(registry.projects, name)) {
    throw new Error(`Project name "${name}" already registered to a different path.`);
  }
  const project: Project = { name, path: cwd, lastSeen: nowIso };
  registry.projects[name] = project;
  saveRegistry(registry);
  return project;
}

/** Mark `name` as the active project. Throws if it is not registered. */
export function setActiveProject(name: string): void {
  const registry = loadRegistry();
  if (!Object.prototype.hasOwnProperty.call(registry.projects, name)) {
    throw new Error(`Unknown project: "${name}"`);
  }
  registry.activeProject = name;
  saveRegistry(registry);
}

/** Resolve a registered project name to its absolute path. Throws if unknown. */
export function resolveProjectPath(name: string): string {
  const registry = loadRegistry();
  const project = registry.projects[name];
  if (!Object.prototype.hasOwnProperty.call(registry.projects, name) || project === undefined) {
    throw new Error(`Unknown project: "${name}"`);
  }
  return project.path;
}

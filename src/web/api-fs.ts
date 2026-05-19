// Filesystem-browse handler for the web dashboard's directory picker.
//
// Backs `GET /api/fs/browse?path=<absolute>` — the server-side replacement for
// the broken `webkitdirectory` picker, which never exposed an absolute path to
// the browser. The dashboard mirrors its own copy of the response shape in
// `dashboard/lib/api-types.ts`; the server and dashboard do NOT share types.
//
// Path traversal is guarded by `resolve()` canonicalization (collapsing `..`
// and `.`), not by a `..` substring check. Every filesystem failure — a
// missing path, a non-directory, EACCES/EPERM on read — degrades to a 400,
// never a 500 or an uncaught throw.

import { readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ServerResponse } from "node:http";
import { sendJson } from "./api-handlers.js";

/** Cap on subdirectories returned by one browse call. */
const MAX_BROWSE_ENTRIES = 1000;

/** One subdirectory entry inside a browsed directory. */
export interface FsDirectoryEntry {
  /** Bare directory name (no path separators). */
  name: string;
  /** Absolute path of the subdirectory. */
  path: string;
}

/** Result of validating and canonicalizing a raw `?path=` query parameter. */
type ValidatedBrowsePath =
  | { ok: true; canonical: string }
  | { ok: false; error: string };

/**
 * Validate and canonicalize the raw `?path=` query parameter. An omitted path
 * defaults to the OS home directory. The `resolve()` call collapses `..`/`.`
 * segments — that canonicalization is the traversal guard.
 */
function validateBrowsePath(rawPath: string | null): ValidatedBrowsePath {
  const target = rawPath ?? homedir();
  if (typeof target !== "string" || target.length === 0) {
    return { ok: false, error: "query parameter path must be a non-empty string" };
  }
  if (target.includes("\0")) {
    return { ok: false, error: "path contains an invalid character" };
  }
  if (!isAbsolute(target)) {
    return { ok: false, error: "path must be absolute" };
  }
  const canonical = resolve(target);
  let stat;
  try {
    stat = statSync(canonical);
  } catch {
    return { ok: false, error: "path does not exist" };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: "path is not a directory" };
  }
  return { ok: true, canonical };
}

/** Whether `path` resolves to a directory; false on any stat failure. */
function isDirectorySafe(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Per-entry `statSync` is used (not `readdirSync(dir,{withFileTypes:true})`)
// so symlinked directories are followed and listed. An entry that cannot be
// stat-ed (dangling symlink, permission-denied subdir) is intentionally
// filtered out — this is per-entry filtering for a directory browser, not
// silent error suppression.
function listSubdirectories(dir: string): { entries: FsDirectoryEntry[]; truncated: boolean } {
  const entries = readdirSync(dir)
    .map((name) => ({ name, path: join(dir, name) }))
    .filter((entry) => isDirectorySafe(entry.path))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > MAX_BROWSE_ENTRIES) {
    return { entries: entries.slice(0, MAX_BROWSE_ENTRIES), truncated: true };
  }
  return { entries, truncated: false };
}

/** `GET /api/fs/browse?path=<absolute>` — list a directory's subdirectories. */
export function browseFilesystem(res: ServerResponse, rawPath: string | null): void {
  const validated = validateBrowsePath(rawPath);
  if (!validated.ok) {
    sendJson(res, 400, { error: validated.error });
    return;
  }
  let result: { entries: FsDirectoryEntry[]; truncated: boolean };
  try {
    result = listSubdirectories(validated.canonical);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? `cannot read directory: ${error.message}` : "cannot read directory",
    });
    return;
  }
  const parent = dirname(validated.canonical);
  sendJson(res, 200, {
    path: validated.canonical,
    parent: parent === validated.canonical ? null : parent,
    entries: result.entries,
    truncated: result.truncated,
  });
}

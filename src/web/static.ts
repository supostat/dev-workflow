// Static-file server for the bundled dashboard (task-055).
//
// Serves `dist/dashboard/` with a strict path-traversal guard: the requested
// path is decoded, NUL-rejected, joined under the static root, resolved, and
// confirmed to stay inside that root via a `startsWith(root + sep)` prefix
// check. Substring checks for ".." are deliberately NOT used — they miss
// encoded payloads and reject legitimate names containing two dots. A
// directory request resolves to its `index.html`; a genuine miss serves the
// pre-rendered `404.html` with status 404.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import type { ServerResponse } from "node:http";
import { PACKAGE_ROOT } from "../lib/package-root.js";

const PACKAGE_DEFAULT_STATIC_ROOT = resolve(PACKAGE_ROOT, "dist", "dashboard");

/**
 * Root the dashboard build is served from.
 *
 * Defaults to `<package>/dist/dashboard`. Overridable per process via the
 * `DEV_WORKFLOW_STATIC_ROOT` env var so that tests can redirect writes to a
 * `mkdtempSync` fixture and never touch real build artifacts (a stale
 * version of this suite used to overwrite then delete files in the real
 * `dist/dashboard`, which `publish.yml` runs between build and publish —
 * release-integrity hazard). Read on every call: env mutations between
 * calls take effect on the next call.
 */
export function staticRoot(): string {
  const override = process.env["DEV_WORKFLOW_STATIC_ROOT"];
  return override !== undefined && override !== ""
    ? resolve(override)
    : PACKAGE_DEFAULT_STATIC_ROOT;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Resolve a request pathname to an absolute file path inside the static
 * root, or `null` when the path is malformed or escapes the root.
 * Exported for tests.
 */
export function resolveStaticPath(pathname: string): string | null {
  return resolveStaticPathUnder(pathname, staticRoot());
}

function resolveStaticPathUnder(pathname: string, root: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded.replace(/^\/+/, "");
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }
  return candidate;
}

/**
 * Serve the static asset addressed by `pathname`. Sends 400 on a malformed
 * or traversal path, the file with its content-type when it exists, the
 * `index.html` of a requested directory, and a 404 otherwise — the
 * pre-rendered `404.html` when present, plain text when it is not.
 *
 * Reads the static root once at the start of the call and reuses it for
 * resolution and the 404-page lookup, so a mid-call env mutation cannot
 * make the request straddle two roots.
 */
export function serveStatic(res: ServerResponse, pathname: string): void {
  const root = staticRoot();
  const resolved = resolveStaticPathUnder(pathname, root);
  if (resolved === null) {
    sendPlain(res, 400, "Bad Request");
    return;
  }
  if (isFile(resolved)) {
    sendFile(res, resolved);
    return;
  }
  if (isDirectory(resolved)) {
    const indexPath = resolve(resolved, "index.html");
    if (isFile(indexPath)) {
      sendFile(res, indexPath);
      return;
    }
  }
  serveNotFound(res, root);
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Serve a 404. Uses the pre-rendered `<root>/404.html` when present — with
 * an explicit `writeHead(404)` since `sendFile` hardcodes 200 — and falls
 * back to a plain-text 404 when that page is absent.
 */
function serveNotFound(res: ServerResponse, root: string): void {
  const notFoundPath = resolve(root, "404.html");
  if (isFile(notFoundPath)) {
    res.writeHead(404, { "Content-Type": CONTENT_TYPES[".html"] });
    res.end(readFileSync(notFoundPath));
    return;
  }
  sendPlain(res, 404, "Not Found");
}

function sendFile(res: ServerResponse, path: string): void {
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const body = readFileSync(path);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
}

function sendPlain(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

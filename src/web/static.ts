// Static-file server for the bundled dashboard SPA (task-055).
//
// Serves `dist/dashboard/` with a strict path-traversal guard: the requested
// path is decoded, NUL-rejected, joined under the static root, resolved, and
// confirmed to stay inside that root via a `startsWith(root + sep)` prefix
// check. Substring checks for ".." are deliberately NOT used — they miss
// encoded payloads and reject legitimate names containing two dots. Unknown
// paths fall back to index.html so client-side routing works (SPA mode).

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import type { ServerResponse } from "node:http";
import { PACKAGE_ROOT } from "../lib/package-root.js";

/** Root the dashboard build is served from — `<package>/dist/dashboard`. */
export const STATIC_ROOT = resolve(PACKAGE_ROOT, "dist", "dashboard");

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
 * Resolve a request pathname to an absolute file path inside {@link STATIC_ROOT},
 * or `null` when the path is malformed or escapes the root. Exported for tests.
 */
export function resolveStaticPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded.replace(/^\/+/, "");
  const candidate = resolve(STATIC_ROOT, relative);
  if (candidate !== STATIC_ROOT && !candidate.startsWith(STATIC_ROOT + sep)) {
    return null;
  }
  return candidate;
}

/**
 * Serve the static asset addressed by `pathname`. Sends 400 on a malformed
 * or traversal path, the file with its content-type when it exists, and an
 * `index.html` SPA fallback otherwise (404 only when even index is absent).
 */
export function serveStatic(res: ServerResponse, pathname: string): void {
  const resolved = resolveStaticPath(pathname);
  if (resolved === null) {
    sendPlain(res, 400, "Bad Request");
    return;
  }
  if (isFile(resolved)) {
    sendFile(res, resolved);
    return;
  }
  const indexPath = resolve(STATIC_ROOT, "index.html");
  if (isFile(indexPath)) {
    sendFile(res, indexPath);
    return;
  }
  sendPlain(res, 404, "Not Found");
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
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

// Settings REST handlers for the web dashboard (task-055).
//
// `GET /api/settings`, `PATCH /api/settings/communication`,
// `PUT /api/settings/profile`. Communication-YAML edits are validated against
// the real parser in an isolated temp directory before they touch the vault,
// so a malformed document never replaces a working `communication.yaml`.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { loadCommunicationConfig } from "../lib/communication.js";
import { getActiveProfile, setActiveProfile } from "../lib/communication-state.js";
import { readLock, LOCK_FILENAME } from "../lib/migration-lock.js";
import { writeFileSafe } from "../lib/fs-helpers.js";
import { sendJson, type ProjectScope } from "./api-handlers.js";

/** `GET /api/settings` — communication profiles + migration-lock presence. */
export function getSettings(res: ServerResponse, scope: ProjectScope): void {
  const config = loadCommunicationConfig(scope.context.vaultPath);
  const lockPresent = existsSync(join(scope.context.projectRoot, ".claude", LOCK_FILENAME));
  sendJson(res, 200, {
    activeProfile: getActiveProfile(scope.context.vaultPath),
    availableProfiles: config !== null ? Object.keys(config.profiles) : [],
    defaultProfile: config?.active_profile ?? null,
    lockFilePresent: lockPresent,
    lock: readLock(scope.context.projectRoot),
  });
}

/**
 * `PATCH /api/settings/communication` — overwrite `communication.yaml`.
 *
 * The content is validated before it touches the vault: it is parsed through
 * {@link loadCommunicationConfig} against a throwaway temp directory. A parse
 * failure yields a 400 with the parser's error message; only valid YAML is
 * committed to `<vault>/communication.yaml`.
 */
export function patchCommunication(
  res: ServerResponse,
  scope: ProjectScope,
  body: Record<string, unknown>,
): void {
  const content = body["content"];
  if (typeof content !== "string" || content.trim() === "") {
    sendJson(res, 400, { error: "body.content must be a non-empty string" });
    return;
  }
  const validationError = validateCommunicationContent(content);
  if (validationError !== null) {
    sendJson(res, 400, { error: validationError });
    return;
  }
  writeFileSafe(join(scope.context.vaultPath, "communication.yaml"), content);
  sendJson(res, 200, { written: true });
}

/**
 * Run `content` through the communication-YAML parser in an isolated temp
 * directory. Returns `null` when it parses cleanly, otherwise the parser's
 * error message. The temp directory is always removed.
 */
function validateCommunicationContent(content: string): string | null {
  const probeDir = mkdtempSync(join(tmpdir(), "dev-workflow-comm-"));
  try {
    writeFileSafe(join(probeDir, "communication.yaml"), content);
    loadCommunicationConfig(probeDir);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "invalid communication YAML";
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

/** `PUT /api/settings/profile` — set the active profile in `.profile-state`. */
export function putProfile(res: ServerResponse, scope: ProjectScope, body: Record<string, unknown>): void {
  const name = body["profile"];
  if (typeof name !== "string" || name.trim() === "") {
    sendJson(res, 400, { error: "body.profile must be a non-empty string" });
    return;
  }
  try {
    setActiveProfile(scope.context.vaultPath, name.trim());
    sendJson(res, 200, { activeProfile: name.trim() });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "invalid profile" });
  }
}

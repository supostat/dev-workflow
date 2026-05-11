import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { WorkflowState } from "../../workflow/state.js";
import type { TelemetryCounters } from "../../workflow/types.js";

export function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return value;
}

export function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return value;
}

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export function searchVaultFiles(vaultPath: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  function scanDirectory(directory: string): void {
    if (!existsSync(directory)) return;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.toLowerCase().includes(lowerQuery)) {
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length, i + 3);
            matches.push({
              file: relative(vaultPath, fullPath),
              line: i + 1,
              content: lines.slice(start, end).join("\n"),
            });
          }
        }
      }
    }
  }

  scanDirectory(vaultPath);
  return matches;
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Increment a telemetry counter for the currently-running workflow (if any).
 * Silent no-op when no active run — matches the original handlers.ts
 * private bumpTelemetry semantics.
 */
export function bumpTelemetry(vaultPath: string, kind: keyof TelemetryCounters): void {
  const state = new WorkflowState(vaultPath);
  const run = state.loadCurrent();
  if (run) state.bumpTelemetry(run.id, kind);
}

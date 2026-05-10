import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function hashString(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function hashFile(path: string): string {
  return hashString(readFileSync(path, "utf-8"));
}

export function formatHash(hex: string): string {
  return `sha256:${hex}`;
}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

export function writeFileSafe(path: string, content: string): void {
  ensureDir(path);
  writeFileSync(path, content, "utf-8");
}

export function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function slugify(input: string): string {
  return input.replace(/\//g, "-");
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

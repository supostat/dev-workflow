import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IntelligenceStore } from "./store.js";
import type { PatternCategory } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function makeId(category: string, content: string): string {
  const slug = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/-$/, "");
  return `${category}:${slug}`;
}

function extractBullets(content: string, sectionHeader: string): string[] {
  const headerIndex = content.indexOf(sectionHeader);
  if (headerIndex === -1) return [];

  const afterHeader = content.slice(headerIndex + sectionHeader.length);
  const nextSection = afterHeader.match(/\n## /);
  const sectionContent = nextSection
    ? afterHeader.slice(0, nextSection.index)
    : afterHeader;

  return sectionContent
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function syncMarkdownFile(
  store: IntelligenceStore,
  filepath: string,
  category: PatternCategory,
  source: string,
): void {
  if (!existsSync(filepath)) return;
  const content = readFileSync(filepath, "utf-8");

  const sections = content.match(/^## .+$/gm) ?? [];
  for (const sectionHeader of sections) {
    const bullets = extractBullets(content, sectionHeader);
    const sectionName = sectionHeader.replace(/^## /, "");

    for (const bullet of bullets) {
      const id = makeId(category, bullet);
      store.upsertNode({
        id,
        category,
        content: `[${sectionName}] ${bullet}`,
        source,
        confidence: 0.5,
        accessCount: 0,
        lastAccessed: now(),
        createdAt: now(),
      });
    }
  }
}

function syncRecordFiles(
  store: IntelligenceStore,
  directory: string,
  category: PatternCategory,
  source: string,
): void {
  if (!existsSync(directory)) return;

  const files = readdirSync(directory).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = readFileSync(join(directory, file), "utf-8");
    const titleMatch = content.match(/^# (.+)$/m);
    const title = titleMatch ? titleMatch[1]! : file.replace(".md", "");

    const id = makeId(category, title);
    store.upsertNode({
      id,
      category,
      content: title,
      source,
      confidence: 0.6,
      accessCount: 0,
      lastAccessed: now(),
      createdAt: now(),
    });
  }
}

export function syncFromVault(store: IntelligenceStore, vaultPath: string): number {
  const before = store.nodeCount();

  syncMarkdownFile(store, join(vaultPath, "conventions.md"), "convention", "vault:conventions");
  syncMarkdownFile(store, join(vaultPath, "knowledge.md"), "gotcha", "vault:knowledge");
  syncRecordFiles(store, join(vaultPath, "architecture"), "decision", "vault:adr");
  syncRecordFiles(store, join(vaultPath, "bugs"), "gotcha", "vault:bugs");
  syncRecordFiles(store, join(vaultPath, "debt"), "pattern", "vault:debt");

  store.save();

  return store.nodeCount() - before;
}

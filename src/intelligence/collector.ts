import type { IntelligenceStore } from "./store.js";
import type { PatternCategory } from "./types.js";

function makeId(category: string, content: string): string {
  const slug = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/-$/, "");
  return `${category}:${slug}`;
}

function now(): string {
  return new Date().toISOString();
}

export class Collector {
  private readonly store: IntelligenceStore;

  constructor(store: IntelligenceStore) {
    this.store = store;
  }

  recordFileEdit(filepath: string): void {
    const id = makeId("file", filepath);
    this.store.upsertNode({
      id,
      category: "file",
      content: filepath,
      source: "auto:edit",
      confidence: 0.5,
      accessCount: 1,
      lastAccessed: now(),
      createdAt: now(),
    });
  }

  recordCoEditedFiles(files: string[]): void {
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const fromId = makeId("file", files[i]!);
        const toId = makeId("file", files[j]!);
        this.store.addEdge({
          from: fromId,
          to: toId,
          relation: "co-edited",
          weight: 0.5,
        });
      }
    }
  }

  recordPattern(category: PatternCategory, content: string, source: string): void {
    const id = makeId(category, content);
    this.store.upsertNode({
      id,
      category,
      content,
      source,
      confidence: 0.6,
      accessCount: 0,
      lastAccessed: now(),
      createdAt: now(),
    });
  }

  recordSession(branch: string, filesChanged: string[]): void {
    const sessionId = makeId("session", `${branch}-${new Date().toISOString().slice(0, 10)}`);
    this.store.upsertNode({
      id: sessionId,
      category: "session",
      content: `Session on ${branch}: ${filesChanged.length} files changed`,
      source: "auto:session",
      confidence: 0.5,
      accessCount: 0,
      lastAccessed: now(),
      createdAt: now(),
    });

    for (const file of filesChanged) {
      const fileId = makeId("file", file);
      this.store.addEdge({
        from: sessionId,
        to: fileId,
        relation: "related",
        weight: 0.3,
      });
    }
  }

  recordTaskCompletion(taskTitle: string, agent: string): void {
    const id = makeId("task", taskTitle);
    this.store.upsertNode({
      id,
      category: "task",
      content: `Task: ${taskTitle} (completed by ${agent})`,
      source: "auto:task",
      confidence: 0.7,
      accessCount: 0,
      lastAccessed: now(),
      createdAt: now(),
    });
  }
}

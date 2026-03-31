import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IntelligenceStore } from "../src/intelligence/store.js";
import { Collector } from "../src/intelligence/collector.js";
import { scoreNodes, topN, formatRelevantContext } from "../src/intelligence/ranker.js";
import { syncFromVault } from "../src/intelligence/sync.js";
import type { PatternNode, ScoringContext } from "../src/intelligence/types.js";

function createTempVault(): string {
  const vaultPath = join(tmpdir(), `dev-vault-intel-test-${Date.now()}`, ".dev-vault");
  mkdirSync(vaultPath, { recursive: true });
  return vaultPath;
}

describe("IntelligenceStore", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = createTempVault();
  });

  afterEach(() => {
    rmSync(join(vaultPath, ".."), { recursive: true, force: true });
  });

  it("creates empty graph", () => {
    const store = new IntelligenceStore(vaultPath);
    expect(store.nodeCount()).toBe(0);
    expect(store.edgeCount()).toBe(0);
  });

  it("upserts and retrieves nodes", () => {
    const store = new IntelligenceStore(vaultPath);
    store.upsertNode({
      id: "test:node",
      category: "pattern",
      content: "Test pattern",
      source: "test",
      confidence: 0.5,
      accessCount: 0,
      lastAccessed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    expect(store.nodeCount()).toBe(1);
    expect(store.getNode("test:node")?.content).toBe("Test pattern");
  });

  it("upsert increases confidence for existing nodes", () => {
    const store = new IntelligenceStore(vaultPath);
    const node = {
      id: "test:node",
      category: "pattern" as const,
      content: "Test",
      source: "test",
      confidence: 0.5,
      accessCount: 0,
      lastAccessed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    store.upsertNode(node);
    store.upsertNode(node);

    expect(store.getNode("test:node")!.confidence).toBeGreaterThan(0.5);
  });

  it("saves and loads from file", () => {
    const store = new IntelligenceStore(vaultPath);
    store.upsertNode({
      id: "test:persist",
      category: "convention",
      content: "Persistent",
      source: "test",
      confidence: 0.8,
      accessCount: 5,
      lastAccessed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    store.save();

    const store2 = new IntelligenceStore(vaultPath);
    expect(store2.nodeCount()).toBe(1);
    expect(store2.getNode("test:persist")?.confidence).toBe(0.8);
  });

  it("adds edges", () => {
    const store = new IntelligenceStore(vaultPath);
    store.addEdge({ from: "a", to: "b", relation: "related", weight: 0.5 });
    store.addEdge({ from: "a", to: "b", relation: "related", weight: 0.5 }); // duplicate

    expect(store.edgeCount()).toBe(1);
  });

  it("records access", () => {
    const store = new IntelligenceStore(vaultPath);
    store.upsertNode({
      id: "test:access",
      category: "pattern",
      content: "Test",
      source: "test",
      confidence: 0.5,
      accessCount: 0,
      lastAccessed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    store.recordAccess("test:access");
    store.recordAccess("test:access");

    expect(store.getNode("test:access")!.accessCount).toBe(2);
    expect(store.getNode("test:access")!.confidence).toBeGreaterThan(0.5);
  });
});

describe("Collector", () => {
  let vaultPath: string;
  let store: IntelligenceStore;
  let collector: Collector;

  beforeEach(() => {
    vaultPath = createTempVault();
    store = new IntelligenceStore(vaultPath);
    collector = new Collector(store);
  });

  afterEach(() => {
    rmSync(join(vaultPath, ".."), { recursive: true, force: true });
  });

  it("records file edits", () => {
    collector.recordFileEdit("src/main.ts");
    expect(store.nodeCount()).toBe(1);
    expect(store.allNodes()[0]!.category).toBe("file");
  });

  it("records co-edited files as edges", () => {
    collector.recordFileEdit("src/a.ts");
    collector.recordFileEdit("src/b.ts");
    collector.recordCoEditedFiles(["src/a.ts", "src/b.ts"]);

    expect(store.edgeCount()).toBe(1);
  });

  it("records session with files", () => {
    collector.recordSession("feature/auth", ["src/auth.ts", "src/config.ts"]);

    expect(store.nodeCount()).toBe(1); // session node
    expect(store.edgeCount()).toBe(2); // session -> file edges
  });

  it("records task completion", () => {
    collector.recordTaskCompletion("Add auth", "coder");
    const nodes = store.allNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.content).toContain("Add auth");
  });
});

describe("Ranker", () => {
  function makeNode(id: string, content: string, confidence: number, accessCount: number, daysAgo: number = 0): PatternNode {
    const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    return {
      id,
      category: "pattern",
      content,
      source: "test",
      confidence,
      accessCount,
      lastAccessed: date,
      createdAt: date,
    };
  }

  it("scores nodes by confidence, recency, frequency", () => {
    const nodes = [
      makeNode("high", "High confidence auth pattern", 0.9, 10, 0),
      makeNode("low", "Low confidence old pattern", 0.2, 1, 30),
    ];

    const context: ScoringContext = { branch: "main", taskTitle: null, recentFiles: [], query: null };
    const scored = scoreNodes(nodes, context);

    expect(scored[0]!.node.id).toBe("high");
    expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);
  });

  it("boosts score for context match", () => {
    const nodes = [
      makeNode("auth", "JWT authentication handler", 0.5, 5, 0),
      makeNode("db", "Database connection pool", 0.5, 5, 0),
    ];

    const context: ScoringContext = { branch: "feature/auth", taskTitle: "Add JWT auth", recentFiles: [], query: null };
    const scored = scoreNodes(nodes, context).sort((a, b) => b.score - a.score);

    expect(scored[0]!.node.id).toBe("auth");
  });

  it("topN returns limited sorted results", () => {
    const nodes = Array.from({ length: 30 }, (_, i) =>
      makeNode(`n${i}`, `Pattern ${i}`, i / 30, i, 0),
    );

    const context: ScoringContext = { branch: "main", taskTitle: null, recentFiles: [], query: null };
    const top = topN(nodes, context, 5);

    expect(top).toHaveLength(5);
    expect(top[0]!.score).toBeGreaterThanOrEqual(top[4]!.score);
  });

  it("formatRelevantContext produces markdown", () => {
    const nodes = [makeNode("test", "Test pattern content", 0.8, 5, 0)];
    const context: ScoringContext = { branch: "main", taskTitle: null, recentFiles: [], query: null };
    const scored = topN(nodes, context, 10);
    const output = formatRelevantContext(scored);

    expect(output).toContain("Relevant Context");
    expect(output).toContain("Test pattern content");
  });
});

describe("syncFromVault", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = createTempVault();
  });

  afterEach(() => {
    rmSync(join(vaultPath, ".."), { recursive: true, force: true });
  });

  it("syncs conventions.md bullets into nodes", () => {
    writeFileSync(join(vaultPath, "conventions.md"), [
      "---", "updated: 2026-03-31", "---",
      "# Conventions", "",
      "## Code Style",
      "- TypeScript strict mode",
      "- No unused variables",
      "",
      "## Naming",
      "- camelCase for functions",
    ].join("\n"), "utf-8");

    const store = new IntelligenceStore(vaultPath);
    const added = syncFromVault(store, vaultPath);

    expect(added).toBe(3);
    expect(store.nodeCount()).toBe(3);
  });

  it("syncs ADR records into nodes", () => {
    mkdirSync(join(vaultPath, "architecture"), { recursive: true });
    writeFileSync(join(vaultPath, "architecture", "2026-03-31-use-axum.md"),
      "# Use Axum for HTTP\n\nBecause of tower ecosystem.", "utf-8");

    const store = new IntelligenceStore(vaultPath);
    syncFromVault(store, vaultPath);

    expect(store.nodeCount()).toBeGreaterThanOrEqual(1);
    expect(store.allNodes().some((n) => n.content.includes("Axum"))).toBe(true);
  });

  it("handles missing vault files gracefully", () => {
    const store = new IntelligenceStore(vaultPath);
    const added = syncFromVault(store, vaultPath);

    expect(added).toBe(0);
  });
});

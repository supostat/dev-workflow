import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileSafe } from "../lib/fs-helpers.js";
import type { IntelligenceGraph, PatternNode, PatternEdge } from "./types.js";

const GRAPH_FILE = ".intelligence.json";

function emptyGraph(): IntelligenceGraph {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: {},
    edges: [],
  };
}

export class IntelligenceStore {
  private readonly filepath: string;
  private graph: IntelligenceGraph;

  constructor(vaultPath: string) {
    this.filepath = join(vaultPath, GRAPH_FILE);
    this.graph = this.load();
  }

  private load(): IntelligenceGraph {
    if (!existsSync(this.filepath)) return emptyGraph();
    try {
      return JSON.parse(readFileSync(this.filepath, "utf-8")) as IntelligenceGraph;
    } catch {
      return emptyGraph();
    }
  }

  save(): void {
    this.graph.updatedAt = new Date().toISOString();
    writeFileSafe(this.filepath, JSON.stringify(this.graph, null, 2));
  }

  getGraph(): IntelligenceGraph {
    return this.graph;
  }

  getNode(id: string): PatternNode | undefined {
    return this.graph.nodes[id];
  }

  upsertNode(node: PatternNode): void {
    const existing = this.graph.nodes[node.id];
    if (existing) {
      existing.content = node.content;
      existing.confidence = Math.min(1, existing.confidence + 0.05);
      existing.lastAccessed = new Date().toISOString();
    } else {
      this.graph.nodes[node.id] = node;
    }
  }

  addEdge(edge: PatternEdge): void {
    const exists = this.graph.edges.some(
      (e) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation,
    );
    if (!exists) {
      this.graph.edges.push(edge);
    }
  }

  recordAccess(nodeId: string): void {
    const node = this.graph.nodes[nodeId];
    if (node) {
      node.accessCount++;
      node.lastAccessed = new Date().toISOString();
      node.confidence = Math.min(1, node.confidence + 0.02);
    }
  }

  nodeCount(): number {
    return Object.keys(this.graph.nodes).length;
  }

  edgeCount(): number {
    return this.graph.edges.length;
  }

  allNodes(): PatternNode[] {
    return Object.values(this.graph.nodes);
  }
}

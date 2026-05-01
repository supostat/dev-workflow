import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve the engram socket path with priority:
 *   1. ENGRAM_SOCKET_PATH env var (trusted local boundary; no validation)
 *   2. <cwd>/.engram/engram.sock (per-project, current engram deploy model)
 *   3. $HOME/.engram/engram.sock (legacy / system-wide fallback)
 *
 * Per-call evaluation — cwd may change between calls in test/async paths.
 * Symlinks are followed (existsSync); user-managed sharing if intentional.
 * TOCTOU: socketCall re-checks existence at use site → safe-fail on race.
 *
 * Exported primarily for testing.
 */
export function resolveSocketPath(): string {
  const envPath = process.env["ENGRAM_SOCKET_PATH"];
  if (envPath && envPath.length > 0) return envPath;
  const projectPath = join(process.cwd(), ".engram", "engram.sock");
  if (existsSync(projectPath)) return projectPath;
  return join(process.env["HOME"] ?? "/tmp", ".engram", "engram.sock");
}

export function isEngramAvailable(): boolean {
  return existsSync(resolveSocketPath());
}
const CONNECT_TIMEOUT_MS = 500;
const REQUEST_TIMEOUT_MS = 2000;
const RETRY_BACKOFF_MS = 300;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message;
    return message === "connect timeout" || message === "request timeout";
  }
  return false;
}

async function socketCallWithRetry(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await socketCall(socketPath, method, params);
  } catch (error) {
    if (!isRetryableError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    return socketCall(socketPath, method, params);
  }
}

interface EngramMemory {
  id: string;
  memory_type: string;
  context: string;
  action: string;
  result: string;
  score: number;
  tags: string;
  project: string;
}

function socketCall(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!existsSync(socketPath)) {
      reject(new Error("socket not found"));
      return;
    }

    const socket = createConnection(socketPath);
    let buffer = "";

    const MAX_BUFFER_BYTES = 1024 * 1024;
    let requestTimer: ReturnType<typeof setTimeout> | null = null;

    const connectTimer = setTimeout(() => {
      socket.destroy();
      reject(new Error("connect timeout"));
    }, CONNECT_TIMEOUT_MS);

    socket.on("connect", () => {
      clearTimeout(connectTimer);
      requestTimer = setTimeout(() => {
        socket.destroy();
        reject(new Error("request timeout"));
      }, REQUEST_TIMEOUT_MS);
      const request = { id: randomUUID(), method, params };
      socket.write(JSON.stringify(request) + "\n");
    });

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > MAX_BUFFER_BYTES) {
        socket.destroy();
        reject(new Error("response too large"));
        return;
      }
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      if (requestTimer) clearTimeout(requestTimer);
      const line = buffer.slice(0, newlineIndex);
      socket.end();

      try {
        const response = JSON.parse(line) as {
          ok: boolean;
          data?: unknown;
          error?: { message: string };
        };
        if (response.ok) {
          resolve(response.data);
        } else {
          reject(new Error(response.error?.message ?? "engram error"));
        }
      } catch {
        reject(new Error("invalid response"));
      }
    });

    socket.on("error", (error) => {
      clearTimeout(connectTimer);
      if (requestTimer) clearTimeout(requestTimer);
      reject(error);
    });
  });
}

export async function engramSearch(
  query: string,
  project?: string,
  limit = 5,
  tags?: string[],
): Promise<EngramMemory[]> {
  try {
    const params: Record<string, unknown> = { query, limit };
    if (project) params["project"] = project;
    if (tags?.length) params["tags"] = JSON.stringify(tags);
    const result = await socketCallWithRetry(resolveSocketPath(), "memory_search", params);
    if (!Array.isArray(result)) return [];
    return result as EngramMemory[];
  } catch {
    return [];
  }
}

/**
 * Store a memory in the engram daemon.
 *
 * Wire format note: tags are sent as `JSON.stringify(tags)` — including the
 * empty case (`tags: []` → wire `"[]"`). This is intentional asymmetry with
 * `engramSearch`, which omits the `tags` param entirely when the filter is
 * empty (skip the filter). Storage always emits a tags-key for consistent
 * payload shape on the daemon side.
 */
export async function engramStore(
  context: string,
  action: string,
  result: string,
  memoryType: string,
  tags: string[],
  project?: string,
): Promise<string | null> {
  try {
    const params: Record<string, unknown> = {
      context,
      action,
      result,
      memory_type: memoryType,
      tags: JSON.stringify(tags),
    };
    if (project) params["project"] = project;
    const response = (await socketCallWithRetry(
      resolveSocketPath(),
      "memory_store",
      params,
    )) as { id?: string } | null;
    return response?.id ?? null;
  } catch {
    return null;
  }
}

export async function engramJudge(
  memoryId: string,
  score: number,
  explanation: string,
): Promise<void> {
  try {
    await socketCall(resolveSocketPath(), "memory_judge", {
      memory_id: memoryId,
      score,
      explanation,
    });
  } catch {
    // fail-safe: daemon unavailable
  }
}

export const PENDING_JUDGMENTS_THRESHOLD = 50;

export interface EngramHealthStatus {
  pendingJudgments: number;
  modelsStale: boolean;
}

export async function engramHealth(
  socketPath?: string,
): Promise<EngramHealthStatus | null> {
  const resolved = socketPath ?? resolveSocketPath();
  if (!existsSync(resolved)) {
    return null;
  }
  try {
    const response = await socketCall(resolved, "memory_health", {});
    if (
      response === null ||
      typeof response !== "object" ||
      !("pending_judgments" in response) ||
      !("models_stale" in response)
    ) {
      return null;
    }
    const record = response as Record<string, unknown>;
    const pendingRaw = Number(record["pending_judgments"]);
    return {
      pendingJudgments: Number.isFinite(pendingRaw) ? pendingRaw : 0,
      modelsStale: Boolean(record["models_stale"]),
    };
  } catch {
    return null;
  }
}

export function formatEngramResults(memories: EngramMemory[]): string {
  if (memories.length === 0) return "";

  const lines: string[] = ["## Engram Memory"];
  for (const memory of memories) {
    const typeLabel = memory.memory_type.toUpperCase();
    const score = memory.score > 0 ? ` (score: ${memory.score.toFixed(1)})` : "";
    lines.push(`- **[${typeLabel}]**${score} ${memory.context}`);
    if (memory.action) {
      lines.push(`  Action: ${memory.action}`);
    }
  }
  return lines.join("\n");
}

const STEP_MEMORY_TYPES: Record<string, string> = {
  read: "context",
  plan: "decision",
  code: "pattern",
  review: "pattern",
  test: "context",
  commit: "context",
};

export interface EngramBeforeStepResult {
  context: string;
  isDegraded: boolean;
  memoryIds: string[];
}

export class EngramBridge {
  private readonly project: string;
  private readonly branch: string;

  constructor(project: string, branch: string) {
    this.project = project;
    this.branch = branch;
  }

  async beforeStep(
    stepName: string,
    taskDescription: string,
  ): Promise<EngramBeforeStepResult> {
    if (!isEngramAvailable()) {
      return { context: "", isDegraded: true, memoryIds: [] };
    }
    const query = `${stepName} ${taskDescription} ${this.branch}`;
    const memories = await engramSearch(query, this.project, 5);
    if (memories.length === 0) {
      return { context: "", isDegraded: false, memoryIds: [] };
    }
    return {
      context: formatEngramResults(memories),
      isDegraded: false,
      memoryIds: memories.map((m) => m.id),
    };
  }

  async afterStep(
    stepName: string,
    output: string,
    status: "completed" | "failed",
    parentId: string | null,
  ): Promise<string | null> {
    const memoryType = status === "failed"
      ? "antipattern"
      : STEP_MEMORY_TYPES[stepName] ?? "context";

    const truncatedOutput = output.length > 500
      ? output.slice(0, 500) + "..."
      : output;

    const tags = [this.project, this.branch, stepName, status];
    const params: Record<string, unknown> = {
      context: `Workflow step [${stepName}]: ${status}`,
      action: truncatedOutput,
      result: `Step ${stepName} ${status} on ${this.branch}`,
      memory_type: memoryType,
      tags: JSON.stringify(tags),
    };
    if (this.project) params["project"] = this.project;
    if (parentId) params["parent_id"] = parentId;

    try {
      const response = (await socketCall(
        resolveSocketPath(),
        "memory_store",
        params,
      )) as { id?: string } | null;
      return response?.id ?? null;
    } catch {
      return null;
    }
  }

  async judge(
    memoryId: string,
    score: number,
    explanation: string,
  ): Promise<void> {
    await engramJudge(memoryId, score, explanation);
  }
}

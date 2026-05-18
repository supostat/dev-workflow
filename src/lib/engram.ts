import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appendEngramTrace } from "./engram-trace.js";

/**
 * Resolve the engram socket path with priority:
 *   1. ENGRAM_SOCKET_PATH env var (trusted local boundary; no validation)
 *   2. <cwd>/.engram/engram.sock — chosen whenever `<cwd>/.engram/` exists
 *      as a directory (per-project deploy marker)
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
  // A `<cwd>/.engram/` directory marks a per-project engram deployment. Its
  // socket is canonical even while the `.sock` file is momentarily absent —
  // the daemon is mid-restart for ~1s while the MCP supervisor respawns it.
  // Probe the DIRECTORY, not the `.sock` file: returning the project socket
  // path lets the caller retry against the right socket instead of silently
  // falling back to a possibly-stale global socket (which ECONNREFUSEs).
  const projectEngramDir = join(process.cwd(), ".engram");
  if (existsSync(projectEngramDir)) return join(projectEngramDir, "engram.sock");
  return join(process.env["HOME"] ?? "/tmp", ".engram", "engram.sock");
}

export function isEngramAvailable(): boolean {
  return existsSync(resolveSocketPath());
}
const CONNECT_TIMEOUT_MS = 500;
const REQUEST_TIMEOUT_MS = 5000;
const RETRY_BACKOFF_MS = 300;

/** Exported primarily for testing. */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  if (message === "connect timeout" || message === "request timeout") return true;
  // Transient during a per-project daemon restart (~1s): the `.sock` file is
  // briefly absent ("socket not found") or present-but-stale (ECONNREFUSED)
  // while the MCP supervisor respawns the daemon. One backoff retry catches
  // the common short-restart case; a longer outage still fails fast.
  if (message === "socket not found") return true;
  return (error as NodeJS.ErrnoException).code === "ECONNREFUSED";
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

export interface EngramMemory {
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
  const start = Date.now();
  const traceOk = (data: unknown): void => {
    appendEngramTrace({
      ts: new Date().toISOString(),
      method,
      params,
      ok: true,
      response_summary: JSON.stringify(data ?? null).slice(0, 500),
      duration_ms: Date.now() - start,
    });
  };
  const traceErr = (message: string): void => {
    appendEngramTrace({
      ts: new Date().toISOString(),
      method,
      params,
      ok: false,
      response_summary: "",
      duration_ms: Date.now() - start,
      error: message,
    });
  };

  return new Promise((resolve, reject) => {
    if (!existsSync(socketPath)) {
      traceErr("socket not found");
      reject(new Error("socket not found"));
      return;
    }

    const socket = createConnection(socketPath);
    let buffer = "";

    const MAX_BUFFER_BYTES = 1024 * 1024;
    let requestTimer: ReturnType<typeof setTimeout> | null = null;

    const connectTimer = setTimeout(() => {
      socket.destroy();
      traceErr("connect timeout");
      reject(new Error("connect timeout"));
    }, CONNECT_TIMEOUT_MS);

    socket.on("connect", () => {
      clearTimeout(connectTimer);
      requestTimer = setTimeout(() => {
        socket.destroy();
        traceErr("request timeout");
        reject(new Error("request timeout"));
      }, REQUEST_TIMEOUT_MS);
      const request = { id: randomUUID(), method, params };
      socket.write(JSON.stringify(request) + "\n");
    });

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > MAX_BUFFER_BYTES) {
        socket.destroy();
        traceErr("response too large");
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
          traceOk(response.data);
          resolve(response.data);
        } else {
          const message = response.error?.message ?? "engram error";
          traceErr(message);
          reject(new Error(message));
        }
      } catch {
        traceErr("invalid response");
        reject(new Error("invalid response"));
      }
    });

    socket.on("error", (error) => {
      clearTimeout(connectTimer);
      if (requestTimer) clearTimeout(requestTimer);
      traceErr(error instanceof Error ? error.message : String(error));
      reject(error);
    });
  });
}

export async function engramSearch(
  query: string,
  project?: string,
  limit = 5,
  tags?: string[],
  socketPath?: string,
): Promise<EngramMemory[]> {
  try {
    const params: Record<string, unknown> = { query, limit };
    if (project) params["project"] = project;
    if (tags?.length) params["tags"] = tags;
    const result = await socketCallWithRetry(
      socketPath ?? resolveSocketPath(),
      "memory_search",
      params,
    );
    if (!Array.isArray(result)) return [];
    return result as EngramMemory[];
  } catch {
    return [];
  }
}

/**
 * Store a memory in the engram daemon.
 *
 * Wire format: tags are sent as a native JSON array (e.g. `["a","b"]`), not as
 * a JSON-encoded string. The daemon (variant B onwards) requires a JSON
 * sequence on `memory_search` — a string yields `[6007] dispatch error:
 * invalid type: string, expected a sequence`. `memory_store` is tolerant and
 * normalizes both formats to a JSON-array string in the storage column, but we
 * send arrays uniformly for consistency.
 *
 * Asymmetry vs `engramSearch`: store always emits the `tags` key (even when
 * empty) for consistent payload shape; search omits the key entirely when the
 * filter is empty.
 */
/**
 * Build the `memory_store` JSON-RPC params payload. Shared by `engramStore`
 * (silent fail-safe), `engramStoreStrict` (throws on daemon errors), and
 * `EngramBridge.afterStep` (per-step audit trail with `parent_id`). Closes
 * debt `2026-05-01-engrambridgeafterstep-refactor-to-use-engramstore-helper.md`
 * by removing wire-shape duplication that previously had to be updated in
 * multiple places (commits `ecdea0e`/`2260cb8` had to patch both).
 */
function buildMemoryStoreParams(
  context: string,
  action: string,
  result: string,
  memoryType: string,
  tags: string[],
  project?: string,
  parentId?: string | null,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    context,
    action,
    result,
    memory_type: memoryType,
    tags,
  };
  if (project) params["project"] = project;
  if (parentId) params["parent_id"] = parentId;
  return params;
}

export async function engramStore(
  context: string,
  action: string,
  result: string,
  memoryType: string,
  tags: string[],
  project?: string,
): Promise<string | null> {
  try {
    const params = buildMemoryStoreParams(context, action, result, memoryType, tags, project);
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

/**
 * Store a memory in the engram daemon (strict variant).
 *
 * Differs from engramStore: throws on daemon errors instead of silently returning null.
 * Use ONLY for user-invoked MCP paths. Auto-mirror callers (vault_record,
 * vaultKnowledge, vaultPattern, EngramBridge) MUST keep using engramStore for
 * the silent fail-safe invariant (ADR 2026-05-01).
 *
 * Error wrapping: original socket/daemon error message preserved inside a
 * prefixed message ("engram memory_store: <original>") so MCP server.ts:107-113
 * surfaces it via isError: true response with both the layer context and the
 * root cause for agent diagnosis.
 *
 * Wire format identical to engramStore (native JSON array for tags).
 */
export async function engramStoreStrict(
  context: string,
  action: string,
  result: string,
  memoryType: string,
  tags: string[],
  project?: string,
): Promise<string> {
  const params = buildMemoryStoreParams(context, action, result, memoryType, tags, project);
  let response: { id?: string } | null;
  try {
    response = (await socketCallWithRetry(
      resolveSocketPath(),
      "memory_store",
      params,
    )) as { id?: string } | null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`engram memory_store: ${message}`);
  }
  if (!response?.id) {
    throw new Error("engram memory_store: response missing id");
  }
  return response.id;
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
    const response = await socketCall(resolved, "memory_status", {});
    if (
      response === null ||
      typeof response !== "object" ||
      !("pending_judgments" in response) ||
      !("hints" in response)
    ) {
      return null;
    }
    const record = response as Record<string, unknown>;
    const pendingRaw = Number(record["pending_judgments"]);
    const hints = Array.isArray(record["hints"]) ? record["hints"] : [];
    const modelsStale = hints.some(
      (hint) => typeof hint === "string" && hint.toLowerCase().includes("models may be outdated"),
    );
    return {
      pendingJudgments: Number.isFinite(pendingRaw) ? pendingRaw : 0,
      modelsStale,
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
    const params = buildMemoryStoreParams(
      `Workflow step [${stepName}]: ${status}`,
      truncatedOutput,
      `Step ${stepName} ${status} on ${this.branch}`,
      memoryType,
      tags,
      this.project,
      parentId,
    );

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

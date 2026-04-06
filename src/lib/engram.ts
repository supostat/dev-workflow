import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_SOCKET_PATH = join(
  process.env["HOME"] ?? "/tmp",
  ".engram",
  "engram.sock",
);

export function isEngramAvailable(): boolean {
  return existsSync(DEFAULT_SOCKET_PATH);
}
const CONNECT_TIMEOUT_MS = 500;
const REQUEST_TIMEOUT_MS = 2000;

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
): Promise<EngramMemory[]> {
  try {
    const params: Record<string, unknown> = { query, limit };
    if (project) params["project"] = project;
    const result = await socketCall(DEFAULT_SOCKET_PATH, "memory_search", params);
    if (!Array.isArray(result)) return [];
    return result as EngramMemory[];
  } catch {
    return [];
  }
}

export async function engramStore(
  context: string,
  action: string,
  result: string,
  memoryType: string,
  tags: string,
  project?: string,
): Promise<string | null> {
  try {
    const params: Record<string, unknown> = {
      context,
      action,
      result,
      memory_type: memoryType,
      tags,
    };
    if (project) params["project"] = project;
    const response = (await socketCall(
      DEFAULT_SOCKET_PATH,
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
    await socketCall(DEFAULT_SOCKET_PATH, "memory_judge", {
      memory_id: memoryId,
      score,
      explanation,
    });
  } catch {
    // fail-safe: daemon unavailable
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

export class EngramBridge {
  private readonly project: string;
  private readonly branch: string;

  constructor(project: string, branch: string) {
    this.project = project;
    this.branch = branch;
  }

  async beforeStep(stepName: string, taskDescription: string): Promise<string> {
    const query = `${stepName} ${taskDescription} ${this.branch}`;
    const memories = await engramSearch(query, this.project, 5);
    return formatEngramResults(memories);
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

    const tags = [this.project, this.branch, stepName, status].join(",");
    const params: Record<string, unknown> = {
      context: `Workflow step [${stepName}]: ${status}`,
      action: truncatedOutput,
      result: `Step ${stepName} ${status} on ${this.branch}`,
      memory_type: memoryType,
      tags,
    };
    if (this.project) params["project"] = this.project;
    if (parentId) params["parent_id"] = parentId;

    try {
      const response = (await socketCall(
        DEFAULT_SOCKET_PATH,
        "memory_store",
        params,
      )) as { id?: string } | null;
      return response?.id ?? null;
    } catch {
      return null;
    }
  }
}

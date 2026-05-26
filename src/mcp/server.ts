import { createInterface } from "node:readline";
import { getToolDefinitions } from "./tools.js";
import { formatToolResult } from "./format-result.js";
import { countTokens } from "../lib/tokens.js";
import { appendTokenTrace, type TokenTracePayload } from "../lib/token-trace.js";
import type { ToolHandlers } from "./handlers.js";
import { getPackageVersion } from "../lib/migration-lock.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function successResponse(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const VAULT_SECTION_FILE_SUFFIX = ".md";

// Map a tool's call arguments to the structured token-trace payload. Only
// string-typed args are lifted; every payload field is optional, so an
// unmapped tool yields {}.
function tokenPayload(source: string, args: Record<string, unknown>): TokenTracePayload {
  switch (source) {
    case "vault_read":
      return typeof args["section"] === "string"
        ? { path: args["section"] + VAULT_SECTION_FILE_SUFFIX }
        : {};
    case "vault_search":
    case "memory_search":
      return typeof args["query"] === "string" ? { query: args["query"] } : {};
    case "memory_judge":
      return typeof args["memory_id"] === "string" ? { memoryId: args["memory_id"] } : {};
    case "task_create_from_phase":
      return typeof args["phaseFile"] === "string" ? { path: args["phaseFile"] } : {};
    default:
      return {};
  }
}

export class McpServer {
  private readonly handlers: ToolHandlers;

  constructor(handlers: ToolHandlers) {
    this.handlers = handlers;
  }

  start(): void {
    if (process.stdin.isTTY) {
      process.stderr.write("MCP server expects piped input. Use with Claude Code MCP integration.\n");
      process.exitCode = 1;
      return;
    }

    const readline = createInterface({ input: process.stdin });

    readline.on("line", (line) => {
      this.handleLine(line).then((response) => {
        if (response) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Internal error";
        process.stdout.write(JSON.stringify(errorResponse(null, -32603, message)) + "\n");
      });
    });

    readline.on("close", () => {
      process.exit(0);
    });
  }

  async handleLine(line: string): Promise<JsonRpcResponse | null> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return errorResponse(null, -32700, "Parse error: invalid JSON");
    }

    if (request.jsonrpc !== "2.0") {
      return errorResponse(request.id ?? null, -32600, "Invalid Request: expected jsonrpc 2.0");
    }

    return this.handleRequest(request);
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    switch (request.method) {
      case "initialize":
        return successResponse(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "dev-workflow", version: getPackageVersion() },
        });

      case "notifications/initialized":
        return null;

      case "ping":
        return successResponse(id, {});

      case "tools/list":
        return successResponse(id, {
          tools: getToolDefinitions(),
        });

      case "tools/call": {
        const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        if (!params?.name) {
          return errorResponse(id, -32602, "Invalid params: missing tool name");
        }

        try {
          const args = params.arguments ?? {};
          const result = await this.handlers.handle(params.name, args);
          const text = formatToolResult(params.name, result);
          try {
            appendTokenTrace({
              source: params.name,
              payload: tokenPayload(params.name, args),
              tokens: countTokens(text),
              chars: text.length,
            });
          } catch {
            // Documented fail-safe: countTokens (tokenizer) is unguarded and could
            // throw; token measurement must never alter or block the tool response.
          }
          return successResponse(id, { content: [{ type: "text", text }] });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Tool execution failed";
          return successResponse(id, {
            content: [{ type: "text", text: message }],
            isError: true,
          });
        }
      }

      default:
        return errorResponse(id, -32601, `Method not found: ${request.method}`);
    }
  }
}

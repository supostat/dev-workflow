import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  engramHealth,
  engramSearch,
  engramStore,
  PENDING_JUDGMENTS_THRESHOLD,
} from "../src/lib/engram.js";

// Unix domain socket paths have a ~104 byte limit on macOS, so tests use a
// short /tmp prefix instead of os.tmpdir() (which resolves to a long path).
const SHORT_TEMP_ROOT = "/tmp";

interface MockResponse {
  ok: boolean;
  data?: unknown;
  error?: { message: string };
}

type Responder = (request: { method: string; params: unknown }) => MockResponse;

async function createMockEngramServer(
  socketPath: string,
  responder: Responder,
): Promise<Server> {
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const request = JSON.parse(buffer.slice(0, newlineIndex)) as {
        method: string;
        params: unknown;
      };
      const response = responder(request);
      socket.write(JSON.stringify(response) + "\n");
      socket.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
    server.listen(socketPath);
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("engramHealth()", () => {
  let tempDir: string;
  let socketPath: string;
  let server: Server | null = null;

  beforeEach(() => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    tempDir = join(SHORT_TEMP_ROOT, `dv-eng-${id}`);
    mkdirSync(tempDir, { recursive: true });
    socketPath = join(tempDir, "e.sock");
  });

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns health when daemon responds with valid data", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: { pending_judgments: 75, models_stale: true },
    }));

    const health = await engramHealth(socketPath);

    expect(health).toEqual({ pendingJudgments: 75, modelsStale: true });
  });

  it("returns clean state when daemon reports zero pending and fresh models", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: { pending_judgments: 0, models_stale: false },
    }));

    const health = await engramHealth(socketPath);

    expect(health).toEqual({ pendingJudgments: 0, modelsStale: false });
  });

  it("returns null when socket file does not exist", async () => {
    const health = await engramHealth(join(tempDir, "nonexistent.sock"));

    expect(health).toBeNull();
  });

  it("returns null when daemon returns error response", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: false,
      error: { message: "memory_health not implemented" },
    }));

    const health = await engramHealth(socketPath);

    expect(health).toBeNull();
  });

  it("returns null when response is missing required fields", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: { pending_judgments: 10 },
    }));

    const health = await engramHealth(socketPath);

    expect(health).toBeNull();
  });

  it("returns null when response data is not an object", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: "unexpected string",
    }));

    const health = await engramHealth(socketPath);

    expect(health).toBeNull();
  });

  it("coerces non-numeric pending_judgments to zero", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: { pending_judgments: "not a number", models_stale: false },
    }));

    const health = await engramHealth(socketPath);

    expect(health).toEqual({ pendingJudgments: 0, modelsStale: false });
  });
});

describe("PENDING_JUDGMENTS_THRESHOLD", () => {
  it("is exported as a positive number", () => {
    expect(typeof PENDING_JUDGMENTS_THRESHOLD).toBe("number");
    expect(PENDING_JUDGMENTS_THRESHOLD).toBeGreaterThan(0);
  });
});

describe("engramStore wire format", () => {
  let socketPath: string;
  let server: Server | null = null;
  let capturedParams: Record<string, unknown> | undefined;

  beforeEach(() => {
    capturedParams = undefined;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    socketPath = join(SHORT_TEMP_ROOT, `dv-store-${process.pid}-${id}.sock`);
  });

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
    delete process.env["ENGRAM_SOCKET_PATH"];
  });

  it("sends tags as JSON-encoded array on the wire", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: { id: "test-id" } };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;

    const id = await engramStore(
      "ctx",
      "act",
      "res",
      "context",
      ["alpha", "beta:1"],
      "proj",
    );

    expect(id).toBe("test-id");
    expect(capturedParams!["tags"]).toBe('["alpha","beta:1"]');
  });

  it("sends empty tags as JSON-encoded empty array", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: { id: "test-id" } };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;

    await engramStore("ctx", "act", "res", "context", [], "proj");

    expect(capturedParams!["tags"]).toBe("[]");
  });

  it("escapes JSON-special characters in individual tags", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: { id: "test-id" } };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;
    // Per-tag validation only rejects `,` and `\n`; quotes and backslashes
    // are allowed. JSON.stringify must escape them correctly so the daemon
    // can parse without ambiguity.
    await engramStore("ctx", "act", "res", "context", ['quote"in:tag', 'back\\slash'], "proj");
    // Verify exact wire output — the JSON encoding escapes quotes/backslashes.
    expect(capturedParams!["tags"]).toBe('["quote\\"in:tag","back\\\\slash"]');
    // And it round-trips: a daemon doing JSON.parse on this gets the original strings.
    expect(JSON.parse(capturedParams!["tags"] as string)).toEqual(['quote"in:tag', 'back\\slash']);
  });
});

describe("engramSearch wire format", () => {
  let socketPath: string;
  let server: Server | null = null;
  let capturedParams: Record<string, unknown> | undefined;

  beforeEach(() => {
    capturedParams = undefined;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    socketPath = join(SHORT_TEMP_ROOT, `dv-search-${process.pid}-${id}.sock`);
  });

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
    delete process.env["ENGRAM_SOCKET_PATH"];
  });

  it("sends tag filter as JSON-encoded array", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: [] };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;

    await engramSearch("query", "proj", 5, ["branch:main"]);

    expect(capturedParams!["tags"]).toBe('["branch:main"]');
  });

  it("omits tags param when filter is empty", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: [] };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;

    await engramSearch("query", "proj", 5, []);

    expect(capturedParams!["tags"]).toBeUndefined();
  });
});

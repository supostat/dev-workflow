import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { engramHealth, PENDING_JUDGMENTS_THRESHOLD } from "../src/lib/engram.js";

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

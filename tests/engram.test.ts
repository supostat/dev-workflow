import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  EngramBridge,
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

  it("returns health with modelsStale=true when hints include outdated-models warning", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: {
        pending_judgments: 75,
        hints: [
          "Models may be outdated. Re-run: engram train",
          "75 memories pending judgment. Use memory_judge to improve search quality",
        ],
      },
    }));

    const health = await engramHealth(socketPath);

    expect(health).toEqual({ pendingJudgments: 75, modelsStale: true });
  });

  it("returns clean state when daemon reports zero pending and no hints", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: { pending_judgments: 0, hints: [] },
    }));

    const health = await engramHealth(socketPath);

    expect(health).toEqual({ pendingJudgments: 0, modelsStale: false });
  });

  it("ignores hints unrelated to model staleness when computing modelsStale", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: true,
      data: {
        pending_judgments: 12,
        hints: ["12 memories pending judgment. Use memory_judge to improve search quality"],
      },
    }));

    const health = await engramHealth(socketPath);

    expect(health).toEqual({ pendingJudgments: 12, modelsStale: false });
  });

  it("returns null when socket file does not exist", async () => {
    const health = await engramHealth(join(tempDir, "nonexistent.sock"));

    expect(health).toBeNull();
  });

  it("returns null when daemon returns error response", async () => {
    server = await createMockEngramServer(socketPath, () => ({
      ok: false,
      error: { message: "memory_status failed" },
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
      data: { pending_judgments: "not a number", hints: [] },
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

  it("sends tags as native array on the wire", async () => {
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
    expect(capturedParams!["tags"]).toEqual(["alpha", "beta:1"]);
  });

  it("sends empty tags as native empty array", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: { id: "test-id" } };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;

    await engramStore("ctx", "act", "res", "context", [], "proj");

    expect(capturedParams!["tags"]).toEqual([]);
  });

  it("preserves JSON-special characters in individual tags as native array elements", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: { id: "test-id" } };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;
    // Per-tag validation only rejects `,` and `\n`; quotes and backslashes
    // are allowed. With native-array wire, JSON-RPC serialization handles the
    // escaping transparently — the daemon receives the original strings.
    await engramStore("ctx", "act", "res", "context", ['quote"in:tag', 'back\\slash'], "proj");
    expect(capturedParams!["tags"]).toEqual(['quote"in:tag', 'back\\slash']);
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

  it("sends tag filter as native array", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: [] };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;

    await engramSearch("query", "proj", 5, ["branch:main"]);

    expect(capturedParams!["tags"]).toEqual(["branch:main"]);
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

describe("EngramBridge.afterStep wire format", () => {
  let socketPath: string;
  let server: Server | null = null;
  let capturedParams: Record<string, unknown> | undefined;

  beforeEach(() => {
    capturedParams = undefined;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    socketPath = join(SHORT_TEMP_ROOT, `dv-bridge-${process.pid}-${id}.sock`);
  });

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
    delete process.env["ENGRAM_SOCKET_PATH"];
  });

  it("sends tags as native array on memory_store wire", async () => {
    server = await createMockEngramServer(socketPath, (request) => {
      capturedParams = request.params as Record<string, unknown>;
      return { ok: true, data: { id: "stored-id" } };
    });
    process.env["ENGRAM_SOCKET_PATH"] = socketPath;

    const bridge = new EngramBridge("proj", "branch");
    const id = await bridge.afterStep("plan", "output", "completed", null);

    expect(id).toBe("stored-id");
    expect(capturedParams!["tags"]).toEqual(["proj", "branch", "plan", "completed"]);
  });
});

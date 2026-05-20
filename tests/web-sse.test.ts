import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  request, type ClientRequest, type IncomingMessage, type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createWebServer, type WebServerHandle } from "../src/web/server.js";
import { SseRegistry, HEARTBEAT_MS } from "../src/web/sse.js";
import { addProject, setActiveProject } from "../src/web/projects.js";
import type { SseTopic } from "../src/web/types.js";

/** One parsed Server-Sent Event. */
interface SseRecord {
  event: string;
  data: string;
}

/**
 * Minimal SSE client over a kept-open `http.request` — `EventSource` is not a
 * Node global on this runtime, so events are parsed manually from the stream.
 */
class SseClient {
  private readonly records: SseRecord[] = [];
  private req: ClientRequest | null = null;
  private res: IncomingMessage | null = null;
  private statusCode = 0;
  private buffer = "";

  connect(port: number, path: string): Promise<number> {
    return new Promise((resolvePromise, reject) => {
      this.req = request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
        this.res = res;
        this.statusCode = res.statusCode ?? 0;
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => this.ingest(chunk));
        resolvePromise(this.statusCode);
      });
      this.req.on("error", reject);
      this.req.end();
    });
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    let separator = this.buffer.indexOf("\n\n");
    while (separator !== -1) {
      const block = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      this.parseBlock(block);
      separator = this.buffer.indexOf("\n\n");
    }
  }

  private parseBlock(block: string): void {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (data !== "" || event !== "message") this.records.push({ event, data });
  }

  /** Wait until at least one record with `event` arrives, or time out. */
  async waitFor(event: string, timeoutMs = 2000): Promise<SseRecord> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.records.find((record) => record.event === event);
      if (found !== undefined) return found;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    throw new Error(`SSE event "${event}" not received within ${timeoutMs}ms`);
  }

  get status(): number {
    return this.statusCode;
  }

  close(): void {
    this.res?.destroy();
    this.req?.destroy();
  }
}

describe("web SSE — multiplexed /events/stream", () => {
  let configHome: string;
  let originalConfigHome: string | undefined;
  let originalSocketPath: string | undefined;
  let projectRoot: string;
  let projectName: string;
  let vaultPath: string;
  let handle: WebServerHandle;
  let port: number;
  const openClients: SseClient[] = [];

  beforeEach(async () => {
    originalConfigHome = process.env.XDG_CONFIG_HOME;
    originalSocketPath = process.env.ENGRAM_SOCKET_PATH;
    configHome = mkdtempSync(join(tmpdir(), "web-sse-cfg-"));
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.ENGRAM_SOCKET_PATH = "/tmp/no-such-engram-socket-isolated-test";

    projectRoot = mkdtempSync(join(tmpdir(), "web-sse-proj-"));
    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    vaultPath = join(projectRoot, ".dev-vault");
    mkdirSync(join(vaultPath, "workflow-state", "runs"), { recursive: true });
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\n", "utf-8");
    projectName = addProject(projectRoot).name;
    setActiveProject(projectName);

    handle = createWebServer();
    await handle.listen(0);
    port = (handle.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const client of openClients.splice(0)) client.close();
    await handle.close();
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    if (originalSocketPath === undefined) delete process.env.ENGRAM_SOCKET_PATH;
    else process.env.ENGRAM_SOCKET_PATH = originalSocketPath;
    rmSync(configHome, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const track = (client: SseClient): SseClient => {
    openClients.push(client);
    return client;
  };

  it("opens the multiplexed stream with a 200 status", async () => {
    const client = track(new SseClient());
    const status = await client.connect(port, `/events/stream?project=${projectName}`);
    expect(status).toBe(200);
  });

  it("delivers a vault event on the multiplexed stream", async () => {
    const client = track(new SseClient());
    await client.connect(port, `/events/stream?project=${projectName}`);
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(join(vaultPath, "knowledge.md"), "# Knowledge\nchanged\n", "utf-8");
    const record = await client.waitFor("vault");
    expect(JSON.parse(record.data).file).toBe("knowledge.md");
  });

  it("delivers a registry-changed event to a project-scoped subscriber (projects-bypass)", async () => {
    // The deviation under test: `projects` topic broadcasts arrive with the
    // empty project name, but every project-scoped subscriber must still
    // receive them. A test that opens against the global registry would
    // not exercise the filter-bypass branch.
    const client = track(new SseClient());
    await client.connect(port, `/events/stream?project=${projectName}`);
    await new Promise((r) => setTimeout(r, 150));
    const other = mkdtempSync(join(tmpdir(), "web-sse-extra-"));
    addProject(other);
    const record = await client.waitFor("projects");
    expect(JSON.parse(record.data).action).toBe("registry-changed");
    rmSync(other, { recursive: true, force: true });
  });

  it("rejects /events/stream with no project param", async () => {
    const client = track(new SseClient());
    const status = await client.connect(port, "/events/stream");
    expect(status).toBe(400);
  });

  it("rejects /events/stream for an unknown project", async () => {
    const client = track(new SseClient());
    const status = await client.connect(port, "/events/stream?project=nonexistent");
    expect(status).toBe(400);
  });

  it("rejects /events/bogus with 404 — only /events/stream is exposed", async () => {
    const client = track(new SseClient());
    const status = await client.connect(port, `/events/bogus?project=${projectName}`);
    expect(status).toBe(404);
  });

  it("51st concurrent SSE connection returns 503 (AC#8)", async () => {
    for (let i = 0; i < 50; i++) {
      const client = track(new SseClient());
      const status = await client.connect(port, `/events/stream?project=${projectName}`);
      expect(status).toBe(200);
    }
    const overflow = track(new SseClient());
    const status = await overflow.connect(port, `/events/stream?project=${projectName}`);
    expect(status).toBe(503);
  });

  it("a disconnected client frees a slot", async () => {
    const clients: SseClient[] = [];
    for (let i = 0; i < 50; i++) {
      const client = new SseClient();
      await client.connect(port, `/events/stream?project=${projectName}`);
      clients.push(client);
    }
    clients[0]!.close();
    await new Promise((r) => setTimeout(r, 150));
    const replacement = track(new SseClient());
    const status = await replacement.connect(port, `/events/stream?project=${projectName}`);
    expect(status).toBe(200);
    for (const client of clients.slice(1)) client.close();
  });
});

describe("web SSE — heartbeat", () => {
  /** A minimal `IncomingMessage` stand-in — only the `close` event is exercised. */
  function makeRequest(): IncomingMessage {
    return new EventEmitter() as unknown as IncomingMessage;
  }

  /** A `ServerResponse` stand-in that records every `write` for assertion. */
  function makeResponse(): { res: ServerResponse; writes: string[] } {
    const emitter = new EventEmitter();
    const writes: string[] = [];
    const res = Object.assign(emitter, {
      writeHead: () => res,
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
      end: () => res,
    }) as unknown as ServerResponse;
    return { res, writes };
  }

  it("emits ONE ping per multiplexed connection — not one per topic", () => {
    // The heartbeat is per-connection, not per-topic. With four topics in the
    // subscriber's set a buggy implementation would fire one timer per topic
    // and write four pings per interval; the multiplexed contract requires
    // exactly one.
    vi.useFakeTimers();
    try {
      const registry = new SseRegistry();
      const { res, writes } = makeResponse();
      const topics = new Set<SseTopic>(["vault", "runs", "projects", "trace"]);
      const opened = registry.open(makeRequest(), res, topics, "proj");
      expect(opened).toBe(true);
      vi.advanceTimersByTime(HEARTBEAT_MS + 100);
      const pings = writes.filter((chunk) => chunk.startsWith("event: ping"));
      expect(pings).toHaveLength(1);
      expect(pings[0]).toBe("event: ping\ndata: \n\n");
      vi.advanceTimersByTime(HEARTBEAT_MS);
      expect(writes.filter((chunk) => chunk.startsWith("event: ping"))).toHaveLength(2);
      registry.closeAll();
    } finally {
      vi.useRealTimers();
    }
  });
});

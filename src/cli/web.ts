// `dev-workflow web` — start the web dashboard (task-057).
//
// Parses `--port`/`--open`/`--no-open`/`--help`, starts `createWebServer()`
// from src/web/server.ts with EADDRINUSE port fallback (5 attempts), optionally
// opens a browser per platform, and installs SIGINT/SIGTERM graceful shutdown.
// The server binds HARD to 127.0.0.1 — there is no `--host` escape hatch by
// design (single-user local tool; see the web-dashboard ADR).

import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { AddressInfo } from "node:net";
import { createWebServer, DEFAULT_PORT, type WebServerHandle } from "../web/server.js";

/** Parsed `dev-workflow web` invocation. */
interface WebOptions {
  /** Requested listen port — fallback may bind a higher one. */
  port: number;
  /** Whether to auto-open a browser once the server is listening. */
  open: boolean;
}

/** A browser-launch command resolved for the current platform. */
interface BrowserCommand {
  command: string;
  args: string[];
}

/** Number of consecutive ports tried before giving up (start then +1..+4). */
const PORT_FALLBACK_ATTEMPTS = 5;
/** Grace period before a hung shutdown is forced to exit. */
const SHUTDOWN_FORCE_TIMEOUT_MS = 5000;

/**
 * Parse and validate a `--port` argument value.
 *
 * Pure. Returns an integer in [1, 65535] or throws on anything else.
 */
export function parsePortValue(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`invalid --port value "${raw}" — expected an integer in 1-65535`);
  }
  return value;
}

/**
 * Parse `dev-workflow web` arguments.
 *
 * Pure. `isTty` is the auto-open default (the orchestrator passes
 * `process.stdout.isTTY === true`). Throws on an unknown flag — citing the ADR
 * — or on a malformed `--port`.
 */
export function parseWebArgs(args: string[], isTty: boolean): WebOptions {
  let port = DEFAULT_PORT;
  let open = isTty;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--port") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error('--port requires a value, e.g. --port 8080');
      }
      port = parsePortValue(value);
      index += 1;
      continue;
    }
    if (flag === "--open") {
      open = true;
      continue;
    }
    if (flag === "--no-open") {
      open = false;
      continue;
    }
    throw new Error(
      `unknown flag "${flag}" — dashboard binds 127.0.0.1 only by design (see ADR)`,
    );
  }

  return { port, open };
}

/**
 * Resolve the per-platform browser-launch command for `url`.
 *
 * Pure: `darwin` → `open`, `win32` → `cmd /c start`, everything else →
 * `xdg-open`.
 */
export function browserOpenCommand(osPlatform: NodeJS.Platform, url: string): BrowserCommand {
  if (osPlatform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (osPlatform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

/** The `dev-workflow web --help` text. Pure. */
export function webHelpText(): string {
  return [
    "dev-workflow web — start the web dashboard (http://127.0.0.1)",
    "",
    "Usage:",
    "  dev-workflow web [options]",
    "",
    "Options:",
    `  --port <N>   Port to bind (default: ${DEFAULT_PORT})`,
    "  --open       Open a browser once the server starts (default in a TTY)",
    "  --no-open    Disable browser auto-open",
    "  --help, -h   Show this help",
    "",
    "The dashboard always binds to 127.0.0.1 (loopback only, by design).",
  ].join("\n");
}

/**
 * Listen on `startPort`, retrying `startPort+1..startPort+4` on EADDRINUSE.
 *
 * Keeps a single `handle` across attempts — a failed listen leaves the
 * underlying server unbound and re-listenable in Node 20+. Returns the bound
 * port read from `server.address()`, never the requested one. Throws once the
 * whole 5-port range is exhausted; rethrows any non-EADDRINUSE error.
 */
export async function listenWithFallback(
  handle: WebServerHandle,
  startPort: number,
): Promise<number> {
  for (let attempt = 0; attempt < PORT_FALLBACK_ATTEMPTS; attempt += 1) {
    const port = startPort + attempt;
    try {
      await handle.listen(port);
      return (handle.server.address() as AddressInfo).port;
    } catch (error) {
      const isPortBusy =
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!isPortBusy) {
        throw error;
      }
      if (attempt < PORT_FALLBACK_ATTEMPTS - 1) {
        process.stderr.write(`Port ${port} in use, trying ${port + 1}...\n`);
      }
    }
  }
  const lastPort = startPort + PORT_FALLBACK_ATTEMPTS - 1;
  throw new Error(
    `Port range ${startPort}-${lastPort} all busy. Specify another via --port`,
  );
}

/**
 * Spawn the platform browser at `url`, detached.
 *
 * A spawn failure (binary missing, non-zero immediate exit) is swallowed — both
 * the synchronous throw path and the async `error` event emit a single stderr
 * warning, and the dashboard keeps running.
 */
export function openBrowser(url: string): void {
  const { command, args } = browserOpenCommand(platform(), url);
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      process.stderr.write(`Could not open a browser automatically — visit ${url}\n`);
    });
    child.unref();
  } catch {
    process.stderr.write(`Could not open a browser automatically — visit ${url}\n`);
  }
}

/**
 * Register SIGINT/SIGTERM handlers that gracefully shut `handle` down.
 *
 * The handler is re-entrancy guarded, arms an unref'd 5s force-exit timer, and
 * exits 0 on a clean close / 1 on a close rejection (clearing the timer first).
 */
export function installShutdownHandlers(handle: WebServerHandle): void {
  let shuttingDown = false;

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("Stopping dashboard server...\n");

    const forceTimer = setTimeout(() => process.exit(1), SHUTDOWN_FORCE_TIMEOUT_MS);
    forceTimer.unref();

    handle
      .close()
      .then(() => {
        clearTimeout(forceTimer);
        process.exit(0);
      })
      .catch(() => {
        clearTimeout(forceTimer);
        process.exit(1);
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

/**
 * `dev-workflow web` entry point.
 *
 * Owns every deliberate exit: argument-parse and listen failures set
 * `process.exitCode = 1` after any cleanup, and the signal handlers drive the
 * exit on a healthy server. Does NOT call `detectContext()` — the web server
 * needs no project/git context.
 */
export async function web(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(webHelpText());
    return;
  }

  let options: WebOptions;
  try {
    options = parseWebArgs(args, process.stdout.isTTY === true);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : "invalid arguments"}`);
    process.exitCode = 1;
    return;
  }

  const handle = createWebServer();

  let boundPort: number;
  try {
    boundPort = await listenWithFallback(handle, options.port);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : "could not start server"}`);
    await handle.close();
    process.exitCode = 1;
    return;
  }

  const url = `http://127.0.0.1:${boundPort}`;
  console.log(`dev-workflow dashboard at ${url} (press Ctrl+C to stop)`);

  if (options.open) {
    openBrowser(url);
  }

  installShutdownHandlers(handle);
}

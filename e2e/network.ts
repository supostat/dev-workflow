import type { Page, Request } from "@playwright/test";

// Network + console observation helpers for the dashboard smoke specs.
//
// A `NetworkRecorder` wires page listeners that accumulate: 4xx/5xx responses,
// console errors and uncaught page exceptions, SSE response statuses, and
// still-open non-SSE requests. SSE EventSource streams are never-ending
// responses, so they are tracked separately — they must never count as a hang.

/** A response that returned a 4xx or 5xx status. */
export interface BadResponse {
  url: string;
  status: number;
}

/** True when `request` is an SSE EventSource stream (an `/events/*` topic). */
export function isSseRequest(request: Request): boolean {
  if (request.resourceType() === "eventsource") return true;
  return new URL(request.url()).pathname.startsWith("/events/");
}

/**
 * True for a browser-default resource-load failure console line. Chrome auto-
 * requests `/favicon.ico` and the static export ships none, logging a
 * `Failed to load resource:` line for the 404 — the line carries NO URL, so it
 * cannot be narrowed to `favicon.ico` by text. Dropping it from `consoleErrors`
 * (reserved for React render errors and uncaught exceptions) is still safe: a
 * genuine *app* sub-resource failure is caught authoritatively elsewhere —
 * an HTTP 4xx/5xx fires a `response` event into `badResponses`, and a network-
 * layer failure (DNS, reset, abort) fires `requestfailed` into `failedNonSse`.
 */
function isResourceLoadNoise(message: string): boolean {
  return message.includes("Failed to load resource:");
}

/** Accumulated network + console observations for one page session. */
export interface NetworkRecorder {
  /** 4xx/5xx responses observed across the session. */
  badResponses: BadResponse[];
  /** `console.error` messages and uncaught page exceptions. */
  consoleErrors: string[];
  /** Status of every SSE `/events/*` response observed. */
  sseResponses: BadResponse[];
  /**
   * URLs of non-SSE requests that fired `requestfailed` — a network-layer
   * failure (DNS, connection reset, abort) that never reaches a `response`
   * event, so it escapes `badResponses` entirely. SSE requests are excluded:
   * they legitimately fail/abort on page teardown.
   */
  failedNonSse: string[];
  /** URLs of non-SSE requests still open at call time. */
  pendingNonSse(): string[];
}

/** Wire observation listeners on `page` and return the accumulating recorder. */
export function recordNetwork(page: Page): NetworkRecorder {
  const badResponses: BadResponse[] = [];
  const consoleErrors: string[] = [];
  const sseResponses: BadResponse[] = [];
  const failedNonSse: string[] = [];
  const openNonSse = new Set<string>();

  page.on("response", (response) => {
    const entry = { url: response.url(), status: response.status() };
    if (isSseRequest(response.request())) sseResponses.push(entry);
    if (response.status() >= 400) badResponses.push(entry);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isResourceLoadNoise(text)) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  page.on("request", (request) => {
    if (!isSseRequest(request)) openNonSse.add(request.url());
  });
  page.on("requestfinished", (request) => openNonSse.delete(request.url()));
  page.on("requestfailed", (request) => {
    openNonSse.delete(request.url());
    if (!isSseRequest(request)) failedNonSse.push(request.url());
  });

  return {
    badResponses,
    consoleErrors,
    sseResponses,
    failedNonSse,
    pendingNonSse: () => [...openNonSse],
  };
}

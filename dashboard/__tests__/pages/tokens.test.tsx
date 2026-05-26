// Page test for the Tokens route — the KPI strip and a by-step row render from
// a mock `TokenRunStatsResponse`, the run picker re-fetches stats for the
// chosen run only, and a rejected first stats fetch shows the error panel with
// a working Retry.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import TokensPage from "@/app/tokens/page";
import { ProjectProvider } from "@/lib/project-context";
import type { TokenRunStatsResponse, TokenRunListResponse } from "@/lib/api";

// Radix `Select` queries pointer-capture and scrolls items into view — jsdom
// ships neither, so both are stubbed before any test opens the run picker.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const RUNS: TokenRunListResponse = {
  runs: [
    { runId: "run-aaaaaaaaaaaa", filePath: "/p/a.tokens.jsonl", mtimeMs: 200 },
    { runId: "run-bbbbbbbbbbbb", filePath: "/p/b.tokens.jsonl", mtimeMs: 100 },
  ],
};

function statsFor(runId: string): TokenRunStatsResponse {
  return {
    runId,
    totalTokens: 120,
    totalChars: 480,
    recordCount: 1,
    durationMs: null,
    startedAt: "2026-05-18T00:00:00.000Z",
    endedAt: "2026-05-18T00:00:00.000Z",
    stepCount: 1,
    byStep: [{ name: "code", tokens: 120, percent: 100 }],
    bySource: [{ name: "vault_read", tokens: 120, callCount: 1, avgTokens: 120 }],
    byVaultFile: [{ path: "knowledge.md", tokens: 120, reads: 1 }],
    byEngramType: [],
    warnings: [],
  };
}

/** JSON `fetch` response helper. */
function ok(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

/** Error `fetch` response helper. */
function fail(message: string): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status: 500,
    statusText: "Error",
    text: () => Promise.resolve(JSON.stringify({ error: message })),
  } as Response);
}

interface TokensFetchOptions {
  /** Override the per-call stats response; default returns `statsFor` of the requested run. */
  stats?: (input: string) => Promise<Response>;
  /** Override the discovered run list; default is `RUNS`. */
  runs?: TokenRunListResponse;
}

interface TokensFetchStub {
  fetchMock: ReturnType<typeof vi.fn>;
  /** Number of times the `/api/tokens/runs` endpoint was hit. */
  runsCalls: () => number;
}

/**
 * Route `fetch` for the Tokens page. The `/api/tokens/runs` branch MUST be
 * tested before `/api/tokens` because the latter is a `startsWith` prefix of
 * the former. `stats` may override per-call to exercise selection/errors;
 * `runs` overrides the discovered run list. The returned `runsCalls` counter
 * lets a test assert the run-list endpoint is hit only on mount.
 */
function stubTokensFetch(options: TokensFetchOptions = {}): TokensFetchStub {
  let runsCallCount = 0;
  const fetchMock = vi.fn((input: string) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (input.startsWith("/api/tokens/runs")) {
      runsCallCount += 1;
      return ok(options.runs ?? RUNS);
    }
    if (input.startsWith("/api/tokens")) {
      return options.stats ? options.stats(input) : ok(statsFor("run-aaaaaaaaaaaa"));
    }
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, runsCalls: () => runsCallCount };
}

/** Render the Tokens page inside the project provider. */
function renderTokens(): void {
  render(<ProjectProvider><TokensPage /></ProjectProvider> as ReactNode);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TokensPage", () => {
  it("renders the KPI strip and a by-step row from the default run", async () => {
    stubTokensFetch();
    renderTokens();
    expect(await screen.findByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText("By step")).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
  });

  it("re-fetches stats for the selected run only", async () => {
    const requestedRunIds: string[] = [];
    const { runsCalls } = stubTokensFetch({
      stats: (input) => {
        const runId = new URL(input, "http://x").searchParams.get("runId");
        requestedRunIds.push(runId ?? "default");
        return ok(statsFor(runId ?? "run-aaaaaaaaaaaa"));
      },
    });
    renderTokens();
    await screen.findByText("Total tokens");
    await userEvent.click(screen.getByRole("combobox", { name: "Select run" }));
    await userEvent.click(await screen.findByRole("option", { name: "run-bbbbbbbbbbbb" }));
    await waitFor(() => expect(requestedRunIds).toContain("run-bbbbbbbbbbbb"));
    // Selecting a run skips the run-list stage — the runs endpoint stays at the
    // single mount-time call rather than being re-fetched.
    expect(runsCalls()).toBe(1);
  });

  it("shows the error panel with Retry when the first stats fetch fails", async () => {
    let attempt = 0;
    stubTokensFetch({
      stats: () => {
        attempt += 1;
        return attempt === 1 ? fail("trace unreadable") : ok(statsFor("run-aaaaaaaaaaaa"));
      },
    });
    renderTokens();
    expect(await screen.findByText("trace unreadable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Total tokens")).toBeInTheDocument();
  });

  it("renders empty states — 'No runs', 'No data', and a '—' duration", async () => {
    stubTokensFetch({
      runs: { runs: [] },
      stats: () =>
        ok({
          runId: "run-aaaaaaaaaaaa",
          totalTokens: 0,
          totalChars: 0,
          recordCount: 0,
          durationMs: null,
          startedAt: null,
          endedAt: null,
          stepCount: 0,
          byStep: [],
          bySource: [],
          byVaultFile: [],
          byEngramType: [],
          warnings: [],
        }),
    });
    renderTokens();
    // KPI strip renders once stats settle; the null duration becomes an em dash.
    expect(await screen.findByText("Total tokens")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    // Empty run list collapses the picker to its "No runs" fallback.
    expect(screen.getByText("No runs")).toBeInTheDocument();
    // Every breakdown is empty, so each renders its "No data" placeholder.
    expect(screen.getAllByText("No data").length).toBeGreaterThan(0);
  });
});

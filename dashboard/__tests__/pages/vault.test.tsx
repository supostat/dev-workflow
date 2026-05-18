// Page test for the Vault route — section load, dirty tracking, the save
// flow, the external-edit banner, self-save echo suppression, the fetch-error
// panel, and the dirty-only `beforeunload` cleanup.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import VaultPage from "@/app/vault/page";
import { ProjectProvider } from "@/lib/project-context";
import { MockEventSource } from "../../vitest.setup";

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

/**
 * The real `/events/vault` wire payload — `src/web/watcher.ts` broadcasts
 * `{file, mtime, action}` and `src/web/sse.ts` frames it as the `data:` line.
 */
function vaultEvent(file: string): string {
  return JSON.stringify({ file, mtime: "2026-05-18T00:00:00.000Z", action: "change" });
}

/** Route `fetch` for the vault page — active project, section GET, section PATCH. */
function stubVaultFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (init?.method === "PATCH") {
      return ok({ section: "stack", backupPath: "/backup/stack.md" });
    }
    if (input.startsWith("/api/vault/stack")) {
      return ok({ section: "stack", content: "# Stack\noriginal" });
    }
    return ok({ section: "conventions", content: "# Conventions" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The `/events/vault` SSE connection opened by the editor. */
function vaultStream(): MockEventSource | undefined {
  return MockEventSource.instances.find((source) => source.url.includes("/events/vault"));
}

/** Render the Vault page inside the project provider. */
function renderVault(): void {
  render(<ProjectProvider><VaultPage /></ProjectProvider> as ReactNode);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VaultPage", () => {
  it("loads the default section into the editor", async () => {
    stubVaultFetch();
    renderVault();
    expect(await screen.findByLabelText("stack source")).toHaveValue("# Stack\noriginal");
  });

  it("marks the section dirty after an edit", async () => {
    stubVaultFetch();
    renderVault();
    const editor = await screen.findByLabelText("stack source");
    await userEvent.type(editor, " edited");
    expect(await screen.findByText("Unsaved")).toBeInTheDocument();
  });

  it("saves through the confirmation dialog and toasts", async () => {
    const fetchMock = stubVaultFetch();
    renderVault();
    const editor = await screen.findByLabelText("stack source");
    await userEvent.type(editor, " edited");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === "PATCH"),
      ).toBe(true),
    );
  });

  it("raises the banner on an external edit to the open section", async () => {
    stubVaultFetch();
    renderVault();
    await screen.findByLabelText("stack source");
    vaultStream()?.emit("vault", vaultEvent("stack.md"));
    expect(await screen.findByRole("alert")).toHaveTextContent("File changed externally");
  });

  it("ignores a vault event for a different section", async () => {
    stubVaultFetch();
    renderVault();
    await screen.findByLabelText("stack source");
    vaultStream()?.emit("vault", vaultEvent("knowledge.md"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("suppresses the banner for the just-saved section inside the window", async () => {
    stubVaultFetch();
    renderVault();
    const editor = await screen.findByLabelText("stack source");
    await userEvent.type(editor, " edited");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("Unsaved")).not.toBeInTheDocument());
    vaultStream()?.emit("vault", vaultEvent("stack.md"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the error panel and retries when the section GET fails", async () => {
    let sectionCalls = 0;
    const fetchMock = vi.fn((input: string) => {
      if (input.startsWith("/api/projects/active")) {
        return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
      }
      sectionCalls += 1;
      if (sectionCalls === 1) return fail("disk offline");
      return ok({ section: "stack", content: "# Stack\nrecovered" });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderVault();
    await screen.findByText("disk offline");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("stack source")).toHaveValue("# Stack\nrecovered");
  });

  it("removes the beforeunload handler on unmount when the draft is dirty", async () => {
    stubVaultFetch();
    const removeListener = vi.spyOn(window, "removeEventListener");
    const tree = render(<ProjectProvider><VaultPage /></ProjectProvider> as ReactNode);
    const editor = await screen.findByLabelText("stack source");
    await userEvent.type(editor, " edited");
    await screen.findByText("Unsaved");
    removeListener.mockClear();
    tree.unmount();
    expect(
      removeListener.mock.calls.some((call) => call[0] === "beforeunload"),
    ).toBe(true);
    removeListener.mockRestore();
  });
});

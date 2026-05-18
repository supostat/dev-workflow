// Page test for the Settings route — the communication form renders, the
// profile picker lists `availableProfiles`, "Activate profile" PUTs the
// profile, "Save" PATCHes the serialized YAML, a PATCH 400 surfaces a toast
// error, the lock viewer pretty-prints the lock, and the project list renders.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import SettingsPage from "@/app/settings/page";
import { ProjectProvider } from "@/lib/project-context";
import type { SettingsResponse, ProjectListResponse } from "@/lib/api";

// Radix `Select` queries pointer-capture and scrolls items into view — jsdom
// ships neither, so both are stubbed before any test opens a profile picker.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const SETTINGS: SettingsResponse = {
  activeProfile: "senior_fast",
  availableProfiles: ["senior_fast"],
  defaultProfile: "senior_fast",
  lockFilePresent: true,
  lock: { version: 1, package_version: "0.1.0" },
};

const PROJECTS: ProjectListResponse = {
  projects: [{ name: "demo", path: "/p", lastSeen: "2026-05-10T00:00:00.000Z", active: true }],
  activeProject: "demo",
};

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
  Toaster: () => null,
}));

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
function fail(message: string, status = 400): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status,
    statusText: "Bad Request",
    text: () => Promise.resolve(JSON.stringify({ error: message })),
  } as Response);
}

/** Route `fetch` for the Settings page; overrides customise the mutations. */
function stubSettingsFetch(overrides?: {
  communication?: () => Promise<Response>;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.startsWith("/api/projects/active")) {
      return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
    }
    if (input.startsWith("/api/projects")) return ok(PROJECTS);
    if (input.startsWith("/api/settings/communication")) {
      return overrides?.communication ? overrides.communication() : ok({ written: true });
    }
    if (input.startsWith("/api/settings/profile")) {
      return ok({ activeProfile: "senior_fast" });
    }
    if (input.startsWith("/api/settings")) return ok(SETTINGS);
    void init;
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Render the Settings page inside the project provider. */
function renderSettings(): void {
  render(<ProjectProvider><SettingsPage /></ProjectProvider> as ReactNode);
}

afterEach(() => {
  vi.unstubAllGlobals();
  toastErrorMock.mockReset();
});

describe("SettingsPage", () => {
  it("renders the communication form and the project list", async () => {
    stubSettingsFetch();
    renderSettings();
    expect(await screen.findByText("Communication")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
    expect(await screen.findByText("demo")).toBeInTheDocument();
  });

  it("lists the available profiles in the profile picker", async () => {
    stubSettingsFetch();
    renderSettings();
    await userEvent.click(await screen.findByRole("combobox", { name: "Select profile" }));
    expect(await screen.findByRole("option", { name: "senior_fast" })).toBeInTheDocument();
  });

  it("PUTs the profile when Activate profile is clicked", async () => {
    const fetchMock = stubSettingsFetch();
    renderSettings();
    await userEvent.click(await screen.findByRole("button", { name: "Activate profile" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            typeof url === "string" &&
            url.startsWith("/api/settings/profile") &&
            (init as RequestInit | undefined)?.method === "PUT",
        ),
      ).toBe(true),
    );
  });

  it("PATCHes the serialized YAML when Save is clicked", async () => {
    const fetchMock = stubSettingsFetch();
    renderSettings();
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.startsWith("/api/settings/communication") &&
          (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      const body = JSON.parse((patch?.[1] as RequestInit).body as string) as { content: string };
      expect(body.content).toContain("active_profile: senior_fast");
      expect(body.content).toContain("    language: ru");
    });
  });

  it("shows a toast error when the communication PATCH fails", async () => {
    stubSettingsFetch({ communication: () => fail("malformed YAML") });
    renderSettings();
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("malformed YAML")),
    );
  });

  it("renders the boolean switches and serializes a toggle into the YAML", async () => {
    const fetchMock = stubSettingsFetch();
    renderSettings();
    const askSwitch = await screen.findByRole("switch", { name: "Ask before acting" });
    expect(askSwitch).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Emojis" })).toBeInTheDocument();

    await userEvent.click(askSwitch);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.startsWith("/api/settings/communication") &&
          (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      const body = JSON.parse((patch?.[1] as RequestInit).body as string) as { content: string };
      expect(body.content).toContain("ask_before_acting: true");
    });
  });

  it("replaces the field form with a CLI-edit notice for a multi-profile file", async () => {
    const multiProfile: SettingsResponse = {
      ...SETTINGS,
      availableProfiles: ["senior_fast", "onboarding"],
    };
    const fetchMock = vi.fn((input: string) => {
      if (input.startsWith("/api/projects/active")) {
        return ok({ activeProject: { name: "demo", path: "/p", lastSeen: "" } });
      }
      if (input.startsWith("/api/projects")) return ok(PROJECTS);
      if (input.startsWith("/api/settings/profile")) return ok({ activeProfile: "senior_fast" });
      if (input.startsWith("/api/settings")) return ok(multiProfile);
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();
    expect(
      await screen.findByText("Multi-profile communication.yaml — edit via CLI."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("pretty-prints the migration lock", async () => {
    stubSettingsFetch();
    renderSettings();
    expect(await screen.findByText("Migration lock")).toBeInTheDocument();
    expect(screen.getByText(/"package_version": "0.1.0"/)).toBeInTheDocument();
  });
});

// Component test for the project-registry editor. Exercises the add-project
// flow end to end: the registry table loads via mocked `getProjects`, the
// "Browse…" button opens `DirectoryBrowserDialog`, confirming a directory
// seeds the path field from the dialog's absolute path, and "Add project"
// POSTs that path through mocked `createProject`.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectRegistryEditor } from "@/components/settings/ProjectRegistryEditor";
import type { FsBrowseResponse, ProjectListResponse } from "@/lib/api";
import type { Project } from "@/lib/types";

// The Radix `Dialog` opened by "Browse…" queries pointer-capture / scroll
// APIs jsdom does not ship.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// `ProjectRegistryEditor` imports `getProjects` / `createProject`, and the
// `DirectoryBrowserDialog` it renders imports `browseFs` — the factory must
// provide all three or the editor crashes on mount.
const getProjectsMock = vi.fn();
const createProjectMock = vi.fn();
const browseFsMock = vi.fn();
vi.mock("@/lib/api", () => ({
  getProjects: () => getProjectsMock() as Promise<ProjectListResponse>,
  createProject: (path: string) => createProjectMock(path) as Promise<Project>,
  browseFs: (path?: string) => browseFsMock(path) as Promise<FsBrowseResponse>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const REGISTRY: ProjectListResponse = {
  projects: [{ name: "demo", path: "/p", lastSeen: "2026-05-10T00:00:00.000Z", active: true }],
  activeProject: "demo",
};

/** A browse listing with sensible defaults overridden per test. */
function listing(overrides: Partial<FsBrowseResponse>): FsBrowseResponse {
  return {
    path: "/home/user",
    parent: "/home",
    entries: [
      { name: "alpha", path: "/home/user/alpha" },
      { name: "zebra", path: "/home/user/zebra" },
    ],
    truncated: false,
    ...overrides,
  };
}

afterEach(() => {
  getProjectsMock.mockReset();
  createProjectMock.mockReset();
  browseFsMock.mockReset();
});

describe("ProjectRegistryEditor", () => {
  it("loads the registry table and POSTs a browsed directory as a new project", async () => {
    getProjectsMock.mockResolvedValue(REGISTRY);
    createProjectMock.mockResolvedValue({ name: "user", path: "/home/user", lastSeen: "" });
    browseFsMock.mockResolvedValue(listing({}));

    render(<ProjectRegistryEditor />);

    // The registry table loads via mocked `getProjects`.
    expect(await screen.findByText("demo")).toBeInTheDocument();

    // The path field starts empty and "Add project" is disabled.
    const pathInput = screen.getByLabelText("Project path");
    expect(pathInput).toHaveValue("");
    const addButton = screen.getByRole("button", { name: "Add project" });
    expect(addButton).toBeDisabled();

    // "Browse…" opens the directory picker.
    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    expect(await screen.findByText("Pick a directory")).toBeInTheDocument();
    expect(await screen.findByText("alpha")).toBeInTheDocument();

    // Confirming the directory seeds the path field and enables "Add project".
    await userEvent.click(
      screen.getByRole("button", { name: /select this directory/i }),
    );
    await waitFor(() => expect(pathInput).toHaveValue("/home/user"));
    expect(addButton).toBeEnabled();

    // "Add project" POSTs the confirmed absolute path.
    await userEvent.click(addButton);
    await waitFor(() => expect(createProjectMock).toHaveBeenCalledWith("/home/user"));
  });
});

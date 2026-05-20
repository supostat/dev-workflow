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

// `ProjectRegistryEditor` imports `getProjects` / `createProject` /
// `deleteProject`, and the `DirectoryBrowserDialog` it renders imports
// `browseFs` — the factory must provide all four or the editor crashes on
// mount.
const getProjectsMock = vi.fn();
const createProjectMock = vi.fn();
const deleteProjectMock = vi.fn();
const browseFsMock = vi.fn();
vi.mock("@/lib/api", () => ({
  getProjects: () => getProjectsMock() as Promise<ProjectListResponse>,
  createProject: (path: string) => createProjectMock(path) as Promise<Project>,
  deleteProject: (name: string) => deleteProjectMock(name) as Promise<void>,
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
  deleteProjectMock.mockReset();
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

  it("removes a project after confirming the AlertDialog and reloads the table", async () => {
    // Two-project registry — remove the idle one, the active one stays.
    const twoProjects: ProjectListResponse = {
      projects: [
        { name: "demo", path: "/p", lastSeen: "2026-05-10T00:00:00.000Z", active: true },
        { name: "scratch", path: "/q", lastSeen: "2026-05-11T00:00:00.000Z", active: false },
      ],
      activeProject: "demo",
    };
    const afterRemove: ProjectListResponse = {
      projects: [twoProjects.projects[0]!],
      activeProject: "demo",
    };
    getProjectsMock.mockResolvedValueOnce(twoProjects).mockResolvedValueOnce(afterRemove);
    deleteProjectMock.mockResolvedValueOnce(undefined);

    render(<ProjectRegistryEditor />);

    expect(await screen.findByText("scratch")).toBeInTheDocument();

    // Each project row carries an aria-labelled "Remove project <name>" button.
    await userEvent.click(screen.getByRole("button", { name: "Remove project scratch" }));

    // Confirmation dialog opens with a "Remove" action.
    expect(await screen.findByText(/Remove project from registry/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledWith("scratch"));
    // After the delete, the editor reloads the registry — scratch disappears.
    await waitFor(() => expect(screen.queryByText("scratch")).not.toBeInTheDocument());
    expect(screen.getByText("demo")).toBeInTheDocument();
  });

  it("warns when removing the active project (server clears the active selection)", async () => {
    const justActive: ProjectListResponse = {
      projects: [{ name: "demo", path: "/p", lastSeen: "2026-05-10T00:00:00.000Z", active: true }],
      activeProject: "demo",
    };
    const empty: ProjectListResponse = { projects: [], activeProject: null };
    getProjectsMock.mockResolvedValueOnce(justActive).mockResolvedValueOnce(empty);
    deleteProjectMock.mockResolvedValueOnce(undefined);

    render(<ProjectRegistryEditor />);

    expect(await screen.findByText("demo")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove project demo" }));

    // The dialog calls out the active-clears side effect explicitly.
    expect(
      await screen.findByText(/currently active.*clear the active selection/i),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteProjectMock).toHaveBeenCalledWith("demo"));
    await waitFor(() => expect(screen.queryByText("demo")).not.toBeInTheDocument());
    expect(screen.getByText("No projects registered.")).toBeInTheDocument();
  });

  it("Cancel keeps the project in the table and does not call deleteProject", async () => {
    getProjectsMock.mockResolvedValue(REGISTRY);

    render(<ProjectRegistryEditor />);

    expect(await screen.findByText("demo")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove project demo" }));
    expect(await screen.findByText(/Remove project from registry/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText(/Remove project from registry/i)).not.toBeInTheDocument(),
    );
    expect(deleteProjectMock).not.toHaveBeenCalled();
    expect(screen.getByText("demo")).toBeInTheDocument();
  });
});

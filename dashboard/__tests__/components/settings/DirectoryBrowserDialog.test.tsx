// Component test for the server-side directory picker. `browseFs` is mocked so
// each navigation, the "Up" enable/disable rule, the select handoff, and the
// error + Retry path are asserted without a real `/api/fs/browse` server.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectoryBrowserDialog } from "@/components/settings/DirectoryBrowserDialog";
import type { FsBrowseResponse } from "@/lib/api";

// Radix `Dialog` queries pointer-capture / scroll APIs jsdom does not ship.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const browseFsMock = vi.fn();
vi.mock("@/lib/api", () => ({
  browseFs: (path?: string) => browseFsMock(path) as Promise<FsBrowseResponse>,
}));

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
  browseFsMock.mockReset();
});

describe("DirectoryBrowserDialog", () => {
  it("loads the home listing on open and renders folder entries", async () => {
    browseFsMock.mockResolvedValue(listing({}));
    render(<DirectoryBrowserDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("zebra")).toBeInTheDocument();
    expect(browseFsMock).toHaveBeenCalledWith(undefined);
  });

  it("navigates into a folder with its absolute path on click", async () => {
    browseFsMock.mockResolvedValue(listing({}));
    render(<DirectoryBrowserDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    await userEvent.click(await screen.findByText("alpha"));
    expect(browseFsMock).toHaveBeenLastCalledWith("/home/user/alpha");
  });

  it("disables Up at the filesystem root and enables it otherwise", async () => {
    browseFsMock.mockResolvedValue(listing({ parent: null }));
    render(<DirectoryBrowserDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    await screen.findByText("alpha");
    expect(screen.getByRole("button", { name: /up/i })).toBeDisabled();
  });

  it("navigates to the parent when Up is clicked", async () => {
    browseFsMock.mockResolvedValue(listing({}));
    render(<DirectoryBrowserDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    await screen.findByText("alpha");
    const up = screen.getByRole("button", { name: /up/i });
    expect(up).toBeEnabled();
    await userEvent.click(up);
    expect(browseFsMock).toHaveBeenLastCalledWith("/home");
  });

  it("hands the current path to onSelect and closes on confirm", async () => {
    browseFsMock.mockResolvedValue(listing({}));
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DirectoryBrowserDialog open onOpenChange={onOpenChange} onSelect={onSelect} />,
    );

    await screen.findByText("alpha");
    await userEvent.click(screen.getByRole("button", { name: /select this directory/i }));
    expect(onSelect).toHaveBeenCalledWith("/home/user");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders the truncated notice when the listing is capped", async () => {
    browseFsMock.mockResolvedValue(listing({ truncated: true }));
    render(<DirectoryBrowserDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText("First 1000 directories shown.")).toBeInTheDocument();
  });

  it("renders the empty-listing notice when there are no subdirectories", async () => {
    browseFsMock.mockResolvedValue(listing({ entries: [] }));
    render(<DirectoryBrowserDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText("No subdirectories.")).toBeInTheDocument();
  });

  it("shows an inline error and re-navigates on Retry", async () => {
    browseFsMock.mockRejectedValueOnce(new Error("path does not exist"));
    render(<DirectoryBrowserDialog open onOpenChange={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText("path does not exist")).toBeInTheDocument();
    browseFsMock.mockResolvedValueOnce(listing({}));
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
  });
});

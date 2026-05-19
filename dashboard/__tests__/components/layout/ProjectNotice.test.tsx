// Component test for `ProjectNotice` — the centered notice rendered by every
// page on a non-ready `useApi()` state. Covers the three reasons: the loading
// placeholder, the actionable no-project hint, and the error reason surfacing
// the passed registry-fetch message verbatim.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectNotice } from "@/components/layout/ProjectNotice";

describe("ProjectNotice", () => {
  it("renders the loading placeholder for the loading reason", () => {
    render(<ProjectNotice reason="loading" />);
    expect(screen.getByText("Loading project…")).toBeInTheDocument();
  });

  it("renders the actionable hint for the no-project reason", () => {
    render(<ProjectNotice reason="no-project" />);
    expect(screen.getByText(/No project registered/)).toBeInTheDocument();
    expect(screen.getByText(/add one in Settings/)).toBeInTheDocument();
  });

  it("renders the passed message for the error reason", () => {
    render(<ProjectNotice reason="error" message="registry fetch failed" />);
    expect(screen.getByText("registry fetch failed")).toBeInTheDocument();
  });
});

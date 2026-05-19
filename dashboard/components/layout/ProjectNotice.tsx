// Centered notice shown by every page while `useApi()` is not ready.
//
// It renders the three non-ready `ApiBinding` discriminants: `loading` while
// the active-project fetch is in flight, `no-project` with an actionable hint
// when the registry has nothing to bind to, and `error` surfacing the actual
// registry-fetch failure message instead of disguising it as "no project".

import type { ReactElement } from "react";

/** The non-ready `ApiBinding` reasons rendered by {@link ProjectNotice}. */
type ProjectNoticeReason = "loading" | "no-project" | "error";

/** Static copy for the non-error reasons. */
const NOTICE_TEXT: Record<Exclude<ProjectNoticeReason, "error">, string> = {
  loading: "Loading project…",
  "no-project":
    "No project registered. Run dev-workflow web from a project directory, or add one in Settings.",
};

/** Render the centered single-line notice for a non-ready `useApi()` state. */
export function ProjectNotice({
  reason,
  message,
}: {
  reason: ProjectNoticeReason;
  message?: string;
}): ReactElement {
  const text = reason === "error" ? (message ?? "Could not load the project.") : NOTICE_TEXT[reason];
  return <p className="mx-auto max-w-4xl py-12 text-center text-sm text-muted-foreground">{text}</p>;
}

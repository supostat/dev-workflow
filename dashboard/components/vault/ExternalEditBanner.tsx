"use client";

// "File changed externally" banner for the Vault editor.
//
// Raised when a `/events/vault` message reports the currently-open section was
// modified outside the dashboard (an editor write, a CLI command). Offers two
// resolutions: reload the server copy and discard local edits, or keep the
// local draft and dismiss the banner.

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExternalEditBannerProps {
  /** Discard the local draft and re-fetch the section from the server. */
  onReload: () => void;
  /** Keep the local draft and dismiss the banner. */
  onKeep: () => void;
}

/** Inline warning bar shown above the editor on an external-edit event. */
export function ExternalEditBanner({ onReload, onKeep }: ExternalEditBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-md border border-status-paused/40 bg-status-paused/10 px-3 py-2"
    >
      <AlertTriangle className="size-4 text-status-paused" />
      <p className="flex-1 text-sm">File changed externally.</p>
      <Button size="xs" variant="outline" onClick={onReload}>
        Reload
      </Button>
      <Button size="xs" variant="ghost" onClick={onKeep}>
        Keep mine
      </Button>
    </div>
  );
}

"use client";

// Server-side directory picker for the Settings project registry.
//
// Replaces the broken `webkitdirectory` `<input>`, which never exposed an
// absolute path to the browser. This modal drives `GET /api/fs/browse`: it
// shows the canonical path of the directory it is on, an "Up" control, and a
// click-to-descend list of subdirectories. "Select this directory" hands the
// caller the absolute path of the directory currently displayed.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { browseFs } from "@/lib/api";
import type { FsBrowseResponse } from "@/lib/api";

interface DirectoryBrowserDialogProps {
  /** Whether the picker is open. */
  open: boolean;
  /** Open/close the picker. */
  onOpenChange: (open: boolean) => void;
  /** Receives the absolute path of the directory the user confirmed. */
  onSelect: (absolutePath: string) => void;
}

/** Reduce an unknown thrown reason to a display message. */
function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Modal directory picker backed by `GET /api/fs/browse`. */
export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  onSelect,
}: DirectoryBrowserDialogProps) {
  const [listing, setListing] = useState<FsBrowseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function navigate(path?: string): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      setListing(await browseFs(path));
    } catch (reason: unknown) {
      setError(describeError(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      void navigate();
    } else {
      setListing(null);
      setError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pick a directory</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {listing?.path ?? "…"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            disabled={listing === null || listing.parent === null || loading}
            onClick={() => listing?.parent !== null && void navigate(listing?.parent)}
          >
            ↑ Up
          </Button>
          {error !== null ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void navigate(listing?.path)}
              >
                Retry
              </Button>
            </div>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ScrollArea className="h-64 rounded-md border">
              <div className="flex flex-col">
                {listing !== null && listing.entries.length === 0 ? (
                  <p className="p-2 text-sm text-muted-foreground">No subdirectories.</p>
                ) : (
                  listing?.entries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className="px-2 py-1 text-left text-sm hover:bg-accent"
                      onClick={() => void navigate(entry.path)}
                    >
                      {entry.name}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
          {listing?.truncated === true ? (
            <p className="text-xs text-muted-foreground">
              First 1000 directories shown.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={listing === null}
            onClick={() => {
              if (listing === null) return;
              onSelect(listing.path);
              onOpenChange(false);
            }}
          >
            Select this directory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

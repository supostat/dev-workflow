"use client";

// Draft-state hook for the Vault editor — extracted from `VaultEditor` so the
// component stays presentational and within the LOC budget.
//
// Owns: the loaded server content, the editable draft, the dirty flag, the
// load/save flows, self-save echo suppression, external-edit detection, and
// the dirty-only `beforeunload` guard.
//
// Echo suppression: a save PATCHes the section, then the server emits a
// `vault` SSE message for the same file. `suppressUntil` is set to
// `Date.now() + SUPPRESS_WINDOW_MS` WHEN THE PATCH RESOLVES (server has
// written and rotated the backup); a vault event for the open section inside
// that window is the dashboard's own write and does not raise the banner.
// Tradeoff: a genuine external edit landing within ~1.5s is also swallowed.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSseTopic } from "@/lib/sse";
import type { BoundApi } from "@/lib/project-context";
import type { VaultSection } from "@/lib/api";

const SUPPRESS_WINDOW_MS = 1_500;

/** Everything `VaultEditor` needs to render and drive one section. */
export interface VaultDraft {
  /** Current editor text. */
  draft: string;
  /** True when the draft diverges from the last loaded/saved content. */
  dirty: boolean;
  /** True while the initial section fetch is in flight. */
  loading: boolean;
  /** The load failure message, or null on success. */
  error: string | null;
  /** True between save dispatch and resolution. */
  saving: boolean;
  /** True when an external edit to the open section was detected. */
  externalEdit: boolean;
  /** Replace the draft text from the editor. */
  setDraft: (value: string) => void;
  /** PATCH the draft to the server; toasts on success and failure. */
  save: () => Promise<void>;
  /** Discard the draft and re-fetch the section. */
  reload: () => Promise<void>;
  /** Dismiss the external-edit banner, keeping the local draft. */
  dismissExternalEdit: () => void;
}

/** Manage the draft lifecycle for one vault `section`. */
export function useVaultDraft(
  api: BoundApi | null,
  section: VaultSection,
): VaultDraft {
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [externalEdit, setExternalEdit] = useState(false);
  const suppressUntil = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (api === null) return;
    setLoading(true);
    try {
      const response = await api.getVaultSection(section);
      setLoaded(response.content);
      setDraft(response.content);
      setError(null);
      setExternalEdit(false);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, [api, section]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useSaveDraft(api, section, draft, suppressUntil, setLoaded, setSaving);
  useExternalEditWatch(section, suppressUntil, setExternalEdit);
  useUnsavedGuard(draft !== loaded);

  return {
    draft,
    dirty: draft !== loaded,
    loading,
    error,
    saving,
    externalEdit,
    setDraft,
    save,
    reload: load,
    dismissExternalEdit: useCallback(() => setExternalEdit(false), []),
  };
}

/** Build the section save action — PATCH, then open the suppression window. */
function useSaveDraft(
  api: BoundApi | null,
  section: VaultSection,
  draft: string,
  suppressUntil: { current: number },
  setLoaded: (value: string) => void,
  setSaving: (value: boolean) => void,
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    if (api === null) return;
    setSaving(true);
    try {
      await api.patchVaultSection(section, draft);
      suppressUntil.current = Date.now() + SUPPRESS_WINDOW_MS;
      setLoaded(draft);
      toast.success(`Saved ${section}.md`);
    } catch (reason: unknown) {
      toast.error(`Failed to save ${section}.md: ${messageOf(reason)}`);
    } finally {
      setSaving(false);
    }
  }, [api, section, draft, suppressUntil, setLoaded, setSaving]);
}

/** Subscribe to the `vault` topic; raise the banner on a non-echo section hit. */
function useExternalEditWatch(
  section: VaultSection,
  suppressUntil: { current: number },
  setExternalEdit: (value: boolean) => void,
): void {
  useVaultEventSubscription((file) => {
    if (file !== `${section}.md`) return;
    if (Date.now() < suppressUntil.current) return;
    setExternalEdit(true);
  });
}

/** Add a dirty-only `beforeunload` guard; remove it on cleanup and unmount. */
function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

function useVaultEventSubscription(onFile: (file: string) => void): void {
  useSseTopic("vault", (data: string) => {
    const file = parseVaultEventFile(data);
    if (file !== null) onFile(file);
  });
}

/**
 * The changed file name carried by a `vault` SSE message. The server
 * (`src/web/watcher.ts`) broadcasts `{file, mtime, action}` as the SSE record
 * payload; `file` is the bare file name (e.g. `stack.md`). Returns null when
 * the payload is malformed or carries no `file` field.
 */
function parseVaultEventFile(data: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "file" in parsed &&
      typeof (parsed as { file: unknown }).file === "string"
    ) {
      return (parsed as { file: string }).file;
    }
  } catch {
    // A non-JSON payload carries no usable file name.
  }
  return null;
}

/** Normalise an unknown thrown value to a message string. */
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

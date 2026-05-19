"use client";

// Vault section editor — a split view: a monospace textarea on the left, the
// live rendered-markdown preview on the right. A dirty badge tracks unsaved
// edits; Save opens a confirmation AlertDialog before the PATCH. The
// external-edit banner appears above the split when `useVaultDraft` detects an
// out-of-band change to the open section.
//
// All draft/save/echo logic lives in `useVaultDraft`; this component is the
// rendering shell for one section.

import { Panel } from "@/components/layout/Panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { renderMarkdown } from "@/lib/markdown";
import type { BoundApi } from "@/lib/project-context";
import type { VaultSection } from "@/lib/api";
import { useVaultDraft } from "./useVaultDraft";
import { ExternalEditBanner } from "./ExternalEditBanner";

// Markdown preview styling. The dashboard ships no Tailwind Typography plugin
// (a no-new-dependency constraint), so block spacing and inline emphasis are
// styled with descendant utilities rather than `prose`.
const MARKDOWN_PREVIEW_CLASS =
  "p-3 text-sm [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 " +
  "[&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_code]:font-mono [&_code]:text-xs [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold " +
  "[&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold " +
  "[&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:mt-2 " +
  "[&_pre]:mt-2 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs " +
  "[&_table]:mt-2 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_td]:border [&_td]:border-border [&_td]:px-2";

interface VaultEditorProps {
  /** Project-bound API, or null while the active project resolves. */
  api: BoundApi | null;
  /** The vault section this editor instance is bound to. */
  section: VaultSection;
  /** Active project name — scopes the `/events/vault` stream; null disables it. */
  project: string | null;
}

/** Split editor + preview for one vault section. */
export function VaultEditor({ api, section, project }: VaultEditorProps) {
  const vault = useVaultDraft(api, section, project);

  if (vault.loading) return <Panel title={section}>Loading…</Panel>;
  if (vault.error !== null) {
    return (
      <Panel title={section}>
        <p className="text-sm text-destructive">{vault.error}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void vault.reload()}>
          Retry
        </Button>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {vault.externalEdit ? (
        <ExternalEditBanner
          onReload={() => void vault.reload()}
          onKeep={vault.dismissExternalEdit}
        />
      ) : null}
      <Panel title={`${section}.md`} actions={<EditorActions vault={vault} />}>
        <div className="grid grid-cols-2 gap-3">
          <Textarea
            aria-label={`${section} source`}
            className="h-112 resize-none font-mono text-sm"
            value={vault.draft}
            onChange={(event) => vault.setDraft(event.target.value)}
          />
          <ScrollArea className="h-112 rounded-md border border-border">
            <article className={MARKDOWN_PREVIEW_CLASS}>
              {renderMarkdown(vault.draft)}
            </article>
          </ScrollArea>
        </div>
      </Panel>
    </div>
  );
}

/** Header slot — the dirty badge and the save-with-confirmation action. */
function EditorActions({ vault }: { vault: ReturnType<typeof useVaultDraft> }) {
  return (
    <>
      {vault.dirty ? (
        <Badge variant="secondary" className="text-[0.65rem]">
          Unsaved
        </Badge>
      ) : null}
      <SaveButton dirty={vault.dirty} saving={vault.saving} onSave={() => void vault.save()} />
    </>
  );
}

/** Save button gated behind a confirmation AlertDialog. */
function SaveButton({
  dirty,
  saving,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="xs" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save vault section?</AlertDialogTitle>
          <AlertDialogDescription>
            The server writes the file and rotates a timestamped backup.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onSave}>Save</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

"use client";

// Vault route (`/vault`) — the four-section vault editor.
//
// A vertical Tabs rail (Stack / Conventions / Knowledge / Gameplan) selects
// which section the split editor renders. `VaultEditor` is keyed on the
// section so a tab switch remounts it with a fresh draft fetch. The page gates
// on `useApi().ready` and renders a loading notice until the project resolves.

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/lib/project-context";
import type { VaultSection } from "@/lib/api";
import { VaultEditor } from "@/components/vault/VaultEditor";

/** The four editable vault sections, in the tab-rail order. */
const SECTIONS: ReadonlyArray<{ value: VaultSection; label: string }> = [
  { value: "stack", label: "Stack" },
  { value: "conventions", label: "Conventions" },
  { value: "knowledge", label: "Knowledge" },
  { value: "gameplan", label: "Gameplan" },
];

export default function VaultPage() {
  const api = useApi();

  if (!api.ready) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">Loading project…</p>
    );
  }

  return (
    <Tabs defaultValue="stack" orientation="vertical" className="mx-auto max-w-6xl">
      <TabsList className="min-w-40">
        {SECTIONS.map((section) => (
          <TabsTrigger key={section.value} value={section.value} className="w-full justify-start">
            {section.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex-1">
        {SECTIONS.map((section) => (
          <TabsContent key={section.value} value={section.value}>
            <VaultEditor api={api.api} section={section.value} />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}

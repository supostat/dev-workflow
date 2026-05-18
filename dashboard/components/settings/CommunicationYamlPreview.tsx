"use client";

// Live read-only YAML preview pane for the communication editor. Renders the
// current `CommunicationForm` state through `serializeCommunicationYaml` so the
// user sees the exact document the Save button will PATCH to the server.

import { Panel } from "@/components/layout/Panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  serializeCommunicationYaml,
  type CommunicationForm,
} from "@/components/settings/communicationYaml";

interface CommunicationYamlPreviewProps {
  /** Active profile name written to the `active_profile:` line. */
  activeProfile: string;
  /** Profile map serialized into the `profiles:` section. */
  profiles: Record<string, CommunicationForm>;
}

/** Read-only monospace pane showing the serialized communication.yaml. */
export function CommunicationYamlPreview({
  activeProfile,
  profiles,
}: CommunicationYamlPreviewProps) {
  const yaml = serializeCommunicationYaml(activeProfile, profiles);
  return (
    <Panel title="communication.yaml preview">
      <ScrollArea className="h-64">
        <pre className="font-mono text-xs leading-relaxed text-foreground">{yaml}</pre>
      </ScrollArea>
    </Panel>
  );
}

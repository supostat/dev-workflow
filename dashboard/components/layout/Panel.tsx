// Reusable panel shell for the Dashboard Grid — a bordered, rounded card with
// a compact uppercase header, an optional actions slot, an optional "live"
// badge, and a content area. Server component: no hooks, no client state.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelProps {
  /** Header label — rendered uppercase. */
  title: string;
  /** Right-aligned header slot for buttons / selectors. */
  actions?: ReactNode;
  /** When true, show a pulsing dot marking a live-updating panel. */
  live?: boolean;
  /** Extra classes for the outer container. */
  className?: string;
  children: ReactNode;
}

/** Bordered panel with an uppercase header and a content slot. */
export function Panel({ title, actions, live, className, children }: PanelProps) {
  return (
    <section className={cn("rounded-md border border-border bg-card", className)}>
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {live ? (
          <span
            className="size-2 animate-pulse rounded-full bg-status-running"
            aria-label="live"
          />
        ) : null}
        {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

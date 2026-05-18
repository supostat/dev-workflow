"use client";

// Navbar refresh control — re-runs the current route's data fetches by
// invoking the App Router's `router.refresh()`. Client component so it can
// reach the router hook.

import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Triggers an App Router data refresh for the current route. */
export function RefreshButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Refresh"
      onClick={() => router.refresh()}
    >
      <RotateCw className="h-4 w-4" />
    </Button>
  );
}

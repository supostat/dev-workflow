"use client";

// Run-detail route (`/workflow/run/?id=run-XXX`). A thin wrapper that puts
// `<RunDetail/>` behind a `<Suspense>` boundary — `useSearchParams()` reads
// the `?id=` query param, and Next 15 requires a Suspense boundary around
// any `useSearchParams()` consumer under the static export (`output:"export"`).

import { Suspense } from "react";
import { RunDetail } from "@/components/workflow/RunDetail";

export default function RunDetailPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <Suspense
        fallback={
          <p className="py-12 text-center text-sm text-muted-foreground">Loading run…</p>
        }
      >
        <RunDetail />
      </Suspense>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";

export function ViewportGuard({ children }: { children: React.ReactNode }) {
  const [tooNarrow, setTooNarrow] = useState(false);

  useEffect(() => {
    const check = () => setTooNarrow(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (tooNarrow) {
    return (
      <div className="flex h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Desktop browser required</h1>
          <p className="mt-2 text-muted-foreground">
            dev-workflow dashboard is designed for desktop screens (1024px+).
            Open this page in a desktop browser to continue.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

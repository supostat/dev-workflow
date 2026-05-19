import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Build-freshness gate for the E2E suite.
//
// The harness boots the *built* CLI (`dist/cli/index.js`) and serves the
// *built* static dashboard export (`dist/dashboard/`). A stale `dist/dashboard`
// — typically clobbered by a prior core-only `tsc` run — lacks the per-route
// HTML pages. Checking the `vault/` route HTML specifically catches that case:
// a fresh static export emits one `index.html` per route.

/** Repo root — `e2e/` sits directly under it. Computed from this module's URL. */
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Built artifacts the harness depends on, relative to the repo root. */
const requiredArtifacts: ReadonlyArray<string> = [
  "dist/cli/index.js",
  "dist/dashboard/index.html",
  "dist/dashboard/vault/index.html",
];

export default function globalSetup(): void {
  const missing = requiredArtifacts.filter(
    (artifact) => !existsSync(join(repoRoot, artifact)),
  );
  if (missing.length > 0) {
    throw new Error(
      `E2E build artifacts missing: ${missing.join(", ")}. ` +
        "Run `pnpm build` before `pnpm test:e2e`.",
    );
  }
}

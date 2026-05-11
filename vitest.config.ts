import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/types.ts",
        "src/index.ts",
        "src/hooks/**",
      ],
      // Baseline established 2026-05-11 after enabling coverage-v8.
      //
      // History (oldest → newest):
      //   1. Initial baseline (commit 02c9ca3): lines 68.14 / fn 73.95 / stmt 67.26 / br 63.95
      //      → thresholds 66 / 72 / 65 / 62
      //   2. After CLI backfill batch (5 test files, +88 tests, 742 → 830):
      //      lines 82.14 / fn 84.54 / stmt 80.56 / br 73.11
      //      → thresholds 80 / 82 / 78 / 71
      //
      // Ratcheting policy: thresholds set ~2pp below measured baseline as a
      // regression floor — narrow enough to catch coverage erosion, wide enough
      // to absorb day-to-day noise. Raise when meaningful new tests land;
      // never lower without ADR-level justification.
      thresholds: {
        lines: 80,
        functions: 82,
        statements: 78,
        branches: 71,
      },
    },
  },
});

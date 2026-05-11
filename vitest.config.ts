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
      // Measured: lines 68.14%, functions 73.95%, statements 67.26%, branches 63.95%.
      // Thresholds set ~2pp below baseline as a regression floor — narrow enough
      // to catch coverage erosion, wide enough to absorb day-to-day noise.
      // Raise (ratchet) when meaningful new tests land; never lower without
      // ADR-level justification.
      thresholds: {
        lines: 66,
        functions: 72,
        statements: 65,
        branches: 62,
      },
    },
  },
});

// Standalone vitest config for the dashboard workspace — separate from the
// core package's vitest. jsdom provides a DOM for React Testing Library;
// `resolve.tsconfigPaths` (native to vitest 4) makes the `@/*` and
// `@dev-workflow/types` aliases from tsconfig.json resolve inside tests.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
  },
});

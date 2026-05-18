// Ambient type augmentation for the dashboard vitest workspace.
//
// `vitest.setup.ts` imports `@testing-library/jest-dom/vitest` to register the
// DOM matchers at runtime; this reference pulls their type declarations into
// the workspace so `toBeInTheDocument`, `toHaveValue`, etc. type-check inside
// `__tests__/**`.

/// <reference types="@testing-library/jest-dom" />

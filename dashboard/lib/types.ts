// Type-only re-export of the core web contract. The `@dev-workflow/types`
// path alias resolves to `../src/web/types.ts` (see tsconfig paths) — being a
// pure declaration file, no core runtime code enters the dashboard bundle.

export type {
  Project,
  ProjectRegistry,
  ApiVaultSection,
  ApiTask,
  ApiWorkflowRun,
  ApiEngramStats,
  ApiSettings,
  SseTopic,
  SseEvent,
} from "@dev-workflow/types";

import type { ApiTask } from "@dev-workflow/types";

/**
 * Smoke helper proving the type-only workspace import resolves and type-checks
 * — `ApiTask` is consumed in a real signature. Renders a human-readable task
 * summary for log lines and tooltips.
 */
export function describeTask(task: ApiTask): string {
  return `${task.id} — ${task.title} [${task.status}]`;
}

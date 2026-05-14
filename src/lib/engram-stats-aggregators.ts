import type { EngramTraceEvent } from "./engram-trace.js";

/**
 * Trace event annotated with its source runId (derived from filename, not from
 * the event payload itself). Used by cross-run aggregators that need to tell
 * which run produced a given event.
 */
export interface AnnotatedEvent extends EngramTraceEvent {
  run_id: string;
}

interface CrossRunReuse {
  total: number;
  reused: number;
  percent: number;
}

interface PerStepHitRate {
  [step: string]: { searches: number; nonEmpty: number; percent: number };
}

interface MissingStepCompleteEntry {
  runId: string;
  step: string;
  searches: number;
  judges: number;
}

interface MissingStepComplete {
  totalRuns: number;
  affectedRuns: MissingStepCompleteEntry[];
  count: number;
}

function tagValue(tags: unknown, prefix: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (typeof tag === "string" && tag.startsWith(prefix)) {
      return tag.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Step name for a trace event. Prefers the top-level `step` field (set by
 * `appendEngramTrace` from `process.env.ENGRAM_STEP`, written since
 * `2026-05-14` Option B fix). Falls back to the legacy `step:<name>` tag in
 * `params.tags` for traces written before that fix (still in the
 * `<vault>/workflow-state/runs/` directory).
 */
function stepOfEvent(event: AnnotatedEvent): string | null {
  if (typeof event.step === "string" && event.step.length > 0) return event.step;
  return tagValue(event.params["tags"], "step:");
}

/**
 * Extract ids of pattern/antipattern memories from a memory_search
 * response_summary blob. `memory_type` lives per-memory inside the JSON array
 * (NOT on event.params — search params shape is `{ query, project, limit, tags }`).
 * Truncated/malformed JSON yields an empty list (conservative under-report).
 */
function extractPatternMemoryIds(responseSummary: string): string[] {
  try {
    const parsed = JSON.parse(responseSummary) as unknown;
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const mem of parsed) {
      if (!mem || typeof mem !== "object") continue;
      const m = mem as { id?: unknown; memory_type?: unknown };
      if (typeof m.id !== "string") continue;
      if (m.memory_type !== "pattern" && m.memory_type !== "antipattern") continue;
      ids.push(m.id);
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * True iff a memory id was retrieved in one run AND judged in a DIFFERENT run.
 * Same-run retrieve+judge does not count — that's intra-run feedback, not
 * cross-run reuse. Returns on the first qualifying pair found.
 */
function isReusedAcrossRuns(
  memoryId: string,
  retrievedByRun: Map<string, Set<string>>,
  judgedByRun: Map<string, Set<string>>,
): boolean {
  const retrieveRuns = retrievedByRun.get(memoryId);
  const judgeRuns = judgedByRun.get(memoryId);
  if (!retrieveRuns || !judgeRuns) return false;
  for (const judgeRun of judgeRuns) {
    for (const retrieveRun of retrieveRuns) {
      if (judgeRun !== retrieveRun) return true;
    }
  }
  return false;
}

/**
 * Mutate `bucket` in place by appending `runId` to the run-id Set for
 * `memoryId`. The Set is created lazily on first call per memoryId,
 * avoiding pre-allocation of empty Sets for every potential memoryId key.
 * Used by cross-run aggregators (retrievedByRun, judgedByRun Maps) to track
 * which runs touched a given memory id via memory_search or memory_judge events.
 */
function addRunToBucket(
  bucket: Map<string, Set<string>>,
  memoryId: string,
  runId: string,
): void {
  let runs = bucket.get(memoryId);
  if (!runs) {
    runs = new Set();
    bucket.set(memoryId, runs);
  }
  runs.add(runId);
}

/** True iff response_summary parses as a non-empty array. */
export function searchHasResults(event: AnnotatedEvent): boolean {
  try {
    const arr = JSON.parse(event.response_summary) as unknown;
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}

/**
 * Cross-run reuse of pattern/antipattern memories.
 *
 * Scope: global scalar — returns a single `{ total, reused, percent }`
 * summarizing cross-run reuse across all runs in the window (not per-run, not
 * per-step).
 *
 * A memory id counts as "reused" iff it was retrieved (memory_search) in one
 * run AND judged (memory_judge) in a DIFFERENT run. Same-run retrieve+judge
 * does not count — that's intra-run feedback, not cross-run reuse.
 *
 * `memory_type` lives per-memory inside the `response_summary` JSON array
 * (NOT on event.params — search params shape is `{ query, project, limit, tags }`).
 * Truncated/malformed JSON yields zero retrieved memories for that event.
 */
export function aggregateCrossRunReuse(events: AnnotatedEvent[]): CrossRunReuse {
  // memoryId -> set of runIds that retrieved it via memory_search
  const retrievedByRun = new Map<string, Set<string>>();
  // memoryId -> set of runIds that judged it via memory_judge
  const judgedByRun = new Map<string, Set<string>>();

  for (const event of events) {
    if (event.method === "memory_search") {
      for (const memoryId of extractPatternMemoryIds(event.response_summary)) {
        addRunToBucket(retrievedByRun, memoryId, event.run_id);
      }
    } else if (event.method === "memory_judge") {
      const memoryId = event.params["memory_id"];
      if (typeof memoryId === "string") {
        addRunToBucket(judgedByRun, memoryId, event.run_id);
      }
    }
  }

  const total = retrievedByRun.size;
  let reused = 0;
  for (const memoryId of retrievedByRun.keys()) {
    if (isReusedAcrossRuns(memoryId, retrievedByRun, judgedByRun)) reused++;
  }
  const percent = total > 0 ? Math.round((reused / total) * 100) : 0;
  return { total, reused, percent };
}

/**
 * Per-step memory_search non-empty hit rate.
 *
 * Scope: global aggregate keyed by step name (across all runs in the window).
 * Multiple runs hitting the same step pool their searches into one slot — this
 * is not a per-run breakdown.
 *
 * Step tag source: `step:<name>` tags come from auto-decoration in
 * `appendEngramTrace` (src/lib/engram-trace.ts) via `run.currentStep` at
 * socketCall time, NOT from caller args. The memoryJudge/memorySearch handler
 * params have no `tags` field of their own — tags are injected by `socketCall`.
 *
 * Non-empty = JSON.parse(response_summary) yields a non-empty array. Truncated
 * or unparseable responses count as empty (e.g. `"null"` is 4 chars but doesn't
 * parse as an array — conservative).
 */
export function aggregatePerStepHitRate(events: AnnotatedEvent[]): PerStepHitRate {
  const perStep: Record<string, { searches: number; nonEmpty: number }> = {};
  for (const event of events) {
    if (event.method !== "memory_search") continue;
    const step = stepOfEvent(event);
    if (!step) continue;
    const slot = perStep[step] ?? { searches: 0, nonEmpty: 0 };
    slot.searches++;
    if (searchHasResults(event)) slot.nonEmpty++;
    perStep[step] = slot;
  }
  const result: PerStepHitRate = {};
  for (const [step, s] of Object.entries(perStep)) {
    result[step] = {
      searches: s.searches,
      nonEmpty: s.nonEmpty,
      percent: s.searches > 0 ? Math.round((s.nonEmpty / s.searches) * 100) : 0,
    };
  }
  return result;
}

/**
 * Detect (run, step) tuples where memory_search returned results but no
 * memory_judge call followed in the same (run, step) bucket. Indicates a
 * skipped feedback loop — the agent searched, got hits, and didn't grade them.
 *
 * Scope: per (run, step) tuple. The `affectedRuns` array has one entry per
 * missing pair, so the same step missing in 3 different runs produces 3
 * entries (sorted by runId desc, then step asc).
 *
 * Step tag source: `step:<name>` tags come from auto-decoration in
 * `appendEngramTrace` (src/lib/engram-trace.ts) via `run.currentStep` at
 * socketCall time, NOT from caller args. The memoryJudge/memorySearch handler
 * params have no `tags` field of their own — tags are injected by `socketCall`.
 */
export function detectMissingStepComplete(
  events: AnnotatedEvent[],
  totalRuns: number,
): MissingStepComplete {
  // key: `${runId} ${step}`
  const byKey = new Map<string, MissingStepCompleteEntry>();
  for (const event of events) {
    const step = stepOfEvent(event);
    if (!step) continue;
    const key = `${event.run_id} ${step}`;
    let slot = byKey.get(key);
    if (!slot) {
      slot = { runId: event.run_id, step, searches: 0, judges: 0 };
      byKey.set(key, slot);
    }
    if (event.method === "memory_search") {
      if (searchHasResults(event)) slot.searches++;
    } else if (event.method === "memory_judge") {
      slot.judges++;
    }
  }
  const affected: MissingStepCompleteEntry[] = [];
  for (const slot of byKey.values()) {
    if (slot.searches > 0 && slot.judges === 0) {
      affected.push(slot);
    }
  }
  affected.sort((a, b) => {
    if (a.runId !== b.runId) return b.runId.localeCompare(a.runId);
    return a.step.localeCompare(b.step);
  });
  return { totalRuns, affectedRuns: affected, count: affected.length };
}

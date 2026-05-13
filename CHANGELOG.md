# Changelog

All notable changes to `@engramm/dev-workflow` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-05-13

Two-day minor release accumulating 27 commits since v1.0.1. Three new
MCP tools that close the long-standing split-brain between the slash
orchestration path and the programmatic `WorkflowEngine.executeLoop`
path; a `phase` field on `WorkflowRun` with auto-tagged engram
correlation; three new `engram-stats` analytic sections; a `--runs all`
syntax for unbounded output; vault snapshots/rollback as a first-class
CLI; structured `--json` output on `dev-workflow status` and
`workflow run --dry-run`; OSS hygiene templates and a migration guide.
No removed CLI commands, no removed MCP tools, no breaking changes to
existing schemas.

### Added

- **`mcp__dev-workflow__step_complete`** finalizes a pipeline step:
  parses the agent's `## Engram Feedback` block server-side, applies
  each judgment via `engramJudge` (silent fail-safe, capped at 20 per
  call), and emits antipattern observability (ids retrieved at BEFORE
  search + score-distribution buckets). NO blanket fallback — memories
  without explicit feedback land in `fallbackIds` for orchestrator-level
  handling, preserving "pending count" as a true integrity metric.
  Defense-in-depth at the MCP boundary: UUID regex on every memory id,
  non-empty memoryType, output length cap (50 KB), JUDGE_CAP=20.
  Closes the judgment-loop gap on the slash orchestration path —
  `WorkflowEngine` already auto-judged on the `dev-workflow run` path,
  but conversational orchestrators were systematically skipping the
  per-step parse+judge instructions. One MCP call replaces five inline
  step-file directives. (`348ed12`)

- **`mcp__dev-workflow__workflow_start`** mirrors `WorkflowEngine.start`
  core logic for the slash orchestration path: generates a
  `run-<12hex>` id via `crypto.randomUUID`, resolves the workflow
  definition (custom → templates → builtins), builds the
  `WorkflowRun` with all per-step `StepState` slots initialized,
  persists to `<vault>/workflow-state/runs/run-<id>.json`, sets
  `ENGRAM_TRACE_FILE` and `ENGRAM_RUN_ID` env vars for downstream
  trace correlation. Validation at the MCP boundary: workflowName
  regex (E001), taskDescription non-empty (E002), taskId pattern
  `^task-\d{3,}$` if provided (E003), unknown workflow (E004), step
  name regex on each definition step (E005, prototype-pollution
  guard). Differs from the engine's `generateRunId` (date-seq) — uses
  prefixed-hex for concurrent-runs friendliness. Existing
  `workflow_create` is unrelated and unchanged (registers custom
  workflow YAML). (`0a8a47e`)

- **`mcp__dev-workflow__step_start`** updates `run.currentStep` at the
  start of each pipeline step so engram trace tags reflect the active
  step instead of staying frozen on the run's initial currentStep
  value. Symmetric pair with `step_complete`. Validation: stepName
  regex (E001), runId regex `^run-[a-f0-9]{12}$` (E002), no active
  run (E003), run not in state — fail loud (E004). Resolution order
  for runId: explicit param → `ENGRAM_RUN_ID` env → throw. Without
  this, every memory_search/judge event tagged `step:<first-step>`
  for the entire run on the slash path. (`06eda14`)

- **`phase` field on `WorkflowRun`** plus `phase:<name>` auto-tag on
  every engram event. New `src/lib/gameplan-parser.ts` extracts the
  active phase from `gameplan.md` via a hybrid sourcing strategy:
  frontmatter `current-phase` field first (structured), `**Active:
  \`<name>\`**` body marker fallback (compatible with existing
  gameplans). Both sources validated against a strict kebab-case regex
  before becoming a tag (defense against prototype-pollution
  candidates like `__proto__`). Snapshot semantics — captured at
  run-init, persisted in the run JSON, mid-run gameplan edits do not
  propagate. Both `WorkflowEngine.start` and the new `workflow_start`
  handler populate the field. (`6c5441a`)

- **Three new `engram-stats` analytic sections**, all derived from the
  existing trace JSONL files (no schema change):
  - `crossRunReuse` — global `{ total, reused, percent }` for
    pattern/antipattern memories retrieved in one run and judged in a
    different one. Filters by `memory_type` inside the search result
    array (not the search event itself, since memory_search params
    carry no type). Same-run reuse excluded — that's a feedback loop,
    not knowledge transfer.
  - `perStepHitRate` — global aggregate keyed by step name:
    `{ searches, nonEmpty, percent }`. Non-empty detection via
    `JSON.parse + Array.isArray + length > 0`, correctly classifying
    the `null` literal (4 chars, valid JSON but not array) as empty.
  - `missingStepComplete` — per `(run, step)` tuple where memory_search
    fired with non-empty results but no memory_judge followed (visible
    signature of a skipped `step_complete` handler call). Sort: runId
    descending, step ascending as tiebreaker.
  All three pure aggregators extracted to
  `src/lib/engram-stats-aggregators.ts` to keep `engram-stats.ts`
  under the 300-LOC convention. (`7a92f3b`)

- **`dev-workflow engram-stats` CLI dashboard.** Aggregates last N runs
  from local trace JSONL + run JSON artifacts (offline-safe, no
  daemon required). Six sections: daemon health (live engramHealth),
  byMethod (search/store/judge counts + errors + avg ms), byMemoryType,
  byStep, recentRuns, warnings (store>0+judge=0 = missed feedback,
  vaultRecord>0+store=0 = mirror miss). Plus best-effort live
  enrichment via `engramSearch(branch:<current>)` for top 5 recent
  memories. Stable `EngramStats` JSON contract for tooling. New
  `/vault:engram-stats` slash wrapper. (`2e2b94e`)

- **Vault snapshots + rollback**: `dev-workflow snapshot
  {create|list|show|rollback|delete}` for point-in-time vault
  recovery. Storage under `<vault>/snapshots/<name>/` with a
  `manifest.json` (`SnapshotMeta` interface stable). Exclusions:
  `snapshots/` recursive, `.edit-log.json`, `.profile-state`,
  `*.engram-trace.jsonl`. Rollback always creates a safety snapshot
  first (reversible). Name validation `/^[a-z0-9][a-z0-9._-]{0,79}$/i`
  (path-traversal guard). Symlinks deliberately skipped on both
  snapshot and rollback (security: outward leak + inward
  overwrite attack vectors). New `/vault:snapshot` and
  `/vault:rollback` slash wrappers — the rollback slash always shows
  a pre-rollback manifest preview and requires exact `yes` (no fuzzy
  match). (`974295b`, `5604211`)

- **`dev-workflow workflow run --dry-run --json`**. Enhanced dry-run
  preview includes subagent resolution (Explore/Full/bash/orch),
  input refs, outputBlock, stepFile, gateCommand, maxAttempts. New
  `--json` mode for tooling integration — stable `DryRunPreview` and
  `DryRunStepPreview` interfaces exported. (`22d67e0`)

- **`dev-workflow status --json`**. Structured-output mode for CI
  dashboards, status bars, scripts. Extracted `collectStatus()` →
  typed `StatusSnapshot` (exported). Post-1.0.x field shape locked,
  additive-only. Error path keeps stderr + exitCode=1 (stdout stays
  parseable). (`b7093c6`)

- **`dev-workflow engram-stats --runs all`** explicit unbounded
  override. `parseRunCount` accepts the literal string `all` and
  returns `Infinity`; `slice(0, Infinity)` returns the full array.
  Case-sensitive (lowercase only) per Unix flag convention. Numeric
  path `--runs N` unchanged; invalid non-numeric values still fall
  back to the default 10. (`65f6b57`)

- **`examples/` gallery + OSS hygiene templates + migration guide.**
  Four runnable example workflows demonstrating distinct
  customization patterns (custom gate command, docs-invariant gate,
  no-review minimal flow, read-only security audit). New
  `CONTRIBUTING.md`, simplified `CODE_OF_CONDUCT.md`,
  `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.md`
  (config disables blank issues + links Security Advisory),
  `.github/PULL_REQUEST_TEMPLATE.md`. New
  `website/content/docs/migrating-to-v1.mdx` documents 3 paths for
  v1.0.0 `gateCommand` breaking change (allowlist PR, multi-step
  split, script file). (`0d39159`)

### Changed

- **Step files routed through the `step_complete` MCP boundary.** All
  six step files (`read`, `plan`, `plan-fix`, `coder`, `review`,
  `verify`) replaced their inline `Step X.2` "parse feedback + judge"
  blocks with a single `step_complete({stepName, runId,
  beforeSearchMemoryIds, output})` call. `review.md` uses a 3-call
  variant — same `stepName="review"` and same `engramMemories` across
  three reviewer outputs; engram daemon aggregates scores per memory
  automatically. (`ec01f75`)

- **All six step files start each step with `step_start`.** Pattern:
  `Step X.0` first item is `step_start({stepName, runId})`, then
  `memory_search`. `review.md` calls `step_start` once for the whole
  review (three reviewers share the same `step:review` tag). Without
  this, every BEFORE-search would inherit the run's initial
  currentStep value. (`06eda14`)

- **`loadPipelineContext` reads `ENGRAM_RUN_ID` env with priority over
  `WorkflowState.loadCurrent()`.** Closes the concurrent-runs caveat:
  parallel orchestrator instances now each inherit their own run id
  through the env, attributing memory tags to the correct run instead
  of the most-recent shared one. Empty-string env treated as unset
  (defensive). When env is set but `state.load(envRunId)` fails, the
  context returns `{ branch, runId }` (orphan-trace mode) — env runId
  wins over state for the runId field specifically. (`6144761`)

- **`WorkflowState` run-state directory migrated from
  `<vault>/workflows/run-*.json` to `<vault>/workflow-state/runs/`.**
  Three surfaces previously disagreed on the path:
  `WorkflowState.save` wrote to `workflows/` mixed with custom-
  workflow YAML, `ENGRAM_TRACE_FILE` env pointed at
  `workflow-state/runs/`, and `engram-stats` filtered runs there.
  Aligned on the latter. `workflows/` is now reserved for YAML
  definitions from `workflow_create`. (Absorbed in `0a8a47e`.) Six
  existing test files updated to use the new path. No legacy run JSON
  files existed at the old location on any audited install.

- **`_dispatch.md` opens with a top-of-file MANDATORY FIRST ACTION
  rule.** Requires `workflow_start` to be the orchestrator's first
  tool call — before any file read, subagent launch, or bash command.
  The deeper "Start workflow run" section already existed but sat at
  line 218 of a 350-line dispatcher prompt; compressed-pipeline
  reading routinely skipped it. The top-of-file directive states the
  rule, the cost of skipping it (no run state, orphaned traces, zero
  metrics), and the failure-mode recovery protocol (abort, call
  retroactively, resume from PREFLIGHT). (`01c4b65`)

- **`engram-protocol.md` `AGENT.md` path fixed for per-project deploy.**
  Template injected into downstream `CLAUDE.md` referenced the legacy
  global `~/.engram/AGENT.md`. After engram's per-project pivot,
  `AGENT.md` lives at `<project>/.engram/AGENT.md` (bundled by
  `engram init`). One-line replacement. (`e92a514`)

- **`memory_store` error message names every missing field.** Before:
  the handler threw `Missing required parameter: action` on the first
  field check, opaque to the calling agent which often retried with a
  different single-field shape. Now: aggregates `context / action /
  result / type`, reports all missing/empty fields at once, points
  back to `tools/list` for the full schema with descriptions. Three
  tests pin the message format. (`ca744d3`)

### Fixed

- **`parseTasksFromPhase` regex `\Z` → `$`.** Phase files without a
  trailing newline parsed as empty because `\Z` is not supported in
  JavaScript regex (silently matched the literal character `Z`). Five
  test fixtures cleaned of `## End` workaround. Regression test for
  no-trailing-newline edge case. (`eac23a7`)

### Internal

- **`src/mcp/handlers.ts` split from 579 LOC to a 190-LOC dispatcher +
  seven domain files** (vault / task / agent / workflow / memory /
  profile / helpers). Public API unchanged — class signature,
  constructor, `handle()` method all preserved. Domain functions take
  explicit deps as args; the dispatcher holds the shared graph.
  Namespace imports `import * as vault from "./handlers/vault.js"`
  keep the switch statement readable. (`b596cf0`)

- **JSDoc on `addRunToBucket` helper** in `engram-stats-aggregators.ts`
  expanded with parameter intent, mutation contract, and the
  algorithm-vs-storage rationale for `Map<runId, Set<memoryId>>` over
  alternative structures. (`9377d55`)

### Tests / governance

- **`SECURITY.md` vulnerability disclosure policy.** Private GitHub
  Security Advisory preferred + email fallback. SLA: 72h ack / 7d
  triage / 14d CRITICAL fix. Scope covers shell injection, prompt
  injection, path traversal, prototype pollution, agent permission
  escapes, supply-chain. Historic v1.0.0 / v1.0.1 fixes referenced as
  seed. (`02c9ca3`)

- **`@vitest/coverage-v8` baseline thresholds** in `vitest.config.ts`:
  lines 80 / functions 82 / statements 78 / branches 71 — set 2pp
  below measured to provide a regression floor. New `pnpm
  test:coverage` script. (`02c9ca3`)

- **CLI test backfill batch — +88 tests / six new files.** Each file
  mirrors the `cli-init.test.ts` real-fixture pattern (mkdtempSync +
  execFileSync git init + console capture). Coverage jumped from
  68.14% lines to 82.14% on this batch. Files covered:
  `cli/task.ts` (26 tests, all seven subcommands), `cli/doctor.ts`
  (15), `cli/status.ts` (11), `cli/search.ts` (10),
  `cli/vault-io.ts` (13 round-trip), `cli/serve.ts` (2 wiring),
  `tasks/phase-tasks.ts` (11). Bug found during backfill:
  `parseTasksFromPhase` regex `\Z` (fixed in `eac23a7`).
  (`26b8247`, `5da202c`, `0ae1860`, `1a6b985`, `4c0aa8f`, `307c453`)

## [1.0.1] — 2026-05-11

Same-day patch on top of v1.0.0. Eight additive / bug-fix commits — no
breaking changes, no API removals, no removed CLI commands. Ships
security fixes (downstream sync script + prompt-injection vector +
prototype pollution) and developer-experience wins (pre-flight agent
validation, trace-file GC, init.ts test coverage).

### Security

- **`sync-from-templates.sh` rejects relative paths and symlinks in target.**
  `bash scripts/sync-from-templates.sh ../some-project` from a CI runner
  would have resolved relative to runner cwd — surprise location. And
  `rsync` followed symlinks by default, letting an attacker who can
  write to `<target>/.claude/` overwrite arbitrary host files via a
  symlink-as-template. Both holes closed: absolute-path guard + pre-rsync
  `find -type l` scan that lists offending entries and aborts. Closes
  debt `2026-04-21-sync-from-templates-path-validation.md`. (`6e28ab1`)

- **Prompt-injection defense for `taskDescription`.** New
  `src/lib/escape-user-input.ts` `escapeUserInput(value, label?)` wraps
  user-controlled strings in a per-call hex-id-fenced block via
  `node:crypto.randomBytes`. Attacker cannot forge a matching end marker
  without the runtime id. Any matching fence markers in the input are
  scrubbed before wrapping (defense even with arbitrary id strings).
  Length capped at 10000 chars with a visible truncation marker
  (DoS guard). Wired at `WorkflowEngine.executeLoop` for
  `run.taskDescription` — every agent prompt that interpolates
  `{{taskDescription}}` now sees the fenced form. Closes debt
  `2026-04-09-prompt-interpolation-no-escaping.md`. (`a69bd62`)

- **`WorkflowState` rejects `__proto__` / `constructor` / `prototype`
  during JSON parse.** All three `JSON.parse` call-sites in `state.ts`
  (load, list, bumpTelemetry) now route through a private
  `parseSafeJson` helper with a reviver that drops reserved keys. A
  malicious run-state file with `{"__proto__":{...}}` would have
  polluted Object.prototype globally; threat vector required write
  access to `.dev-vault/workflows/`, but the cost is one Set.has per
  key. (`6c55fa5`)

### Developer experience

- **`dev-workflow validate` pre-flight agent resolution check.** Without
  this, a typo in `agent:` only surfaced at runtime when the engine
  first tried to resolve the step — pipeline aborted mid-execution
  after preflight, losing accumulated work. `validate` now loads an
  `AgentRegistry` from the bundled `templates/agents/` + optional
  `<cwd>/.dev-vault/agents/`, and emits a warning for any step whose
  `agent` is not found in either source. Closes debt
  `2026-04-22-loaderts...md` finding #2. (`de2e0a5`)

### Reliability

- **Lazy GC for stale engram trace files at session-start.** Without
  bound, the `<vault>/workflow-state/runs/*.engram-trace.jsonl`
  directory accumulated 5-10 files/day × 30-100 KB each — MB-GB over
  months. New `gcEngramTraces(runsDir, {maxAgeMs?, maxFiles?})` in
  `engram-trace.ts` deletes traces older than 30 days OR beyond the
  newest 100, skipping the file pointed to by `ENGRAM_TRACE_FILE`
  (active write). Fire-and-forget at session-start, silent on errors.
  Closes debt
  `2026-05-01-engram-trace-file-rotationarchival-policy.md`. (`0e7d15f`)

### Internals (no user-visible change)

- **`buildMemoryStoreParams` helper centralizes `memory_store` params
  shape.** Three call paths (`engramStore` silent fail-safe,
  `engramStoreStrict` throws-on-error, `EngramBridge.afterStep`
  per-step audit) all built the same shape inline. Previous wire-
  format migrations (commits `ecdea0e` / `2260cb8`) had to patch all
  three. Helper deduplicates without changing socket-call semantics
  (engramStore retries, afterStep is fire-and-forget). Wire-format
  pinning tests pass unchanged. Closes debt
  `2026-05-01-engrambridgeafterstep-refactor-to-use-engramstore-helper.md`. (`5825f15`)

- **CHANGELOG accuracy fix for the v1.0.0 entry**: the v1.0.0 entry
  originally mentioned "promisified `execFile`", but the shipped
  implementation uses `spawn(bin, args, { stdio: "inherit" })` via the
  `runGateBinary` helper. `promisify(execFile)` was tried during CODE
  iter1 but `ExecFileOptions` does not accept `stdio: "inherit"` —
  output would silently buffer, bad UX for long-running gates. Entry
  now reflects shipped reality. (`d2ca153`)

### Tests

- 3 MCP `tools/call` error-path tests added: `params=null` and
  `params.name` missing both return JSON-RPC invalid-params (-32602);
  handler-throw is wrapped as `result.isError: true` (NOT an error
  envelope), with original request ID echoed so the client can
  correlate. The third case pins the MCP contract — a future change to
  throw JSON-RPC errors would break compliant clients. (`202881f`)

- 9 E2E tests for `src/cli/init.ts` (was 364 LOC without a dedicated
  test file). Real-fixture pattern: `mkdtempSync` + `execFileSync` git
  init + `process.chdir` save/restore + console capture. Covers
  CLAUDE.md, `.claude/settings.json` valid + hooks block, `.mcp.json`
  wired to `dev-workflow serve`, `.claude/commands/` copied,
  `.claude/agents/` copied, `.dev-vault/` scaffolded with all four
  sections, not-a-git-repo error path, idempotency without `--force`,
  settings.json merge preserves user fields. (`57b18f7`)

- 17 unit tests for `src/lib/interpolate.ts` (was 0). Single-pass
  substitution property pinned: `{{a}}` resolving to `{{b}}` does NOT
  re-interpolate to `b`'s value — defense-in-depth against late-
  binding injection. (Included in `a69bd62`.)

- 13 unit tests for `src/lib/escape-user-input.ts`. Forge prevention,
  truncation boundary, multi-line preserve, custom label. (Included
  in `a69bd62`.)

- 7 unit tests for `gcEngramTraces`. maxAge-only delete, maxFiles-cap
  delete, active-file skip, non-trace-files ignored, missing-directory
  no-throw. (Included in `0e7d15f`.)

- 3 tests for `WorkflowState` `__proto__` poisoned-JSON rejection (load
  + list paths, constructor / prototype variants). (Included in
  `6c55fa5`.)

**Test totals**: 687 → **742** (+55 across the patch).

## [1.0.0] — 2026-05-11

First stable release. Security-driven major bump: `gateCommand` execution and
gate-checker exception handling are now hardened against arbitrary command
execution and runtime crashes respectively.

### Security (BREAKING)

- **`gateCommand` no longer executes via shell.** `execSync(commandString)` in
  `CliGateChecker.checkTestsPass` and `checkCustomCommand` is replaced with
  `spawn(bin, args, { stdio: "inherit" })` via a new `runGateBinary` helper.
  `spawn` is chosen over `promisify(execFile)` because the latter does not
  accept `stdio: "inherit"` and would silently buffer output — bad UX for
  long-running gate runs (test suites). Shell metacharacters (`|`, `;`, `&&`,
  `$VAR`, backticks, redirects) no longer have any effect — they are passed
  through as literal arguments to the binary. Closes debt
  `2026-04-22-loaderts--missing-validation-on-gatecommand-agent-onfail.md`
  finding #1 (CRITICAL — RCE via YAML injection).
- **Hardcoded allowlist for `custom-command` gate binaries.** Only the
  following binaries may be invoked via `gateCommand`: `eslint`, `jest`,
  `node`, `npm`, `npx`, `pnpm`, `prettier`, `tsc`, `vitest`, `yarn`. Any other
  binary — including shells (`bash`, `sh`, `zsh`, `fish`) — throws a
  descriptive `Error` listing the allowlist. This is enforced at runtime at
  the call boundary in `CliGateChecker.checkCustomCommand`.
- **Note**: `checkTestsPass` does NOT use the allowlist. Its command comes
  from `agent.permissions.shellCommands[0]` (agent definitions — trusted
  source), not from user-supplied YAML, so its threat model differs.

### Reliability

- **`WorkflowEngine.executeLoop` now catches gate-checker exceptions.** Closes
  debt `2026-04-23-gate-checker-exceptions-not-caught-in-workflowengineexecuteloop.md`.
  Previously, an exception from `gateChecker.checkTestsPass` / `checkReviewPass` /
  `checkCustomCommand` (e.g. `ENOENT` when `npm` is not on PATH, allowlist
  rejection, async I/O failures) propagated out of `executeLoop`, leaving
  workflow state unsaved and crashing the CLI with a stack trace. The engine
  now: marks the step `failed`, writes `step.error` with the wrapped message,
  sets `run.status = "failed"`, persists state via `state.save(run)`, and
  returns cleanly. `StepState.error?: string` field added to types.

### Migration

If you have a workflow YAML using shell pipes in `gateCommand`:

```yaml
# Before (v0.x) — runs via /bin/sh -c, shell metacharacters work
- name: gate
  gate: custom-command
  gateCommand: "npm test && eslint ."
```

→ After (v1.0+) — pick one:

1. **Move composite logic to a script file**:
   ```yaml
   gateCommand: "node scripts/gate-check.js"
   ```
   `scripts/gate-check.js` invokes `npm test`, then `eslint`, exits non-zero
   if either fails.

2. **Split into multiple workflow steps**, each with its own gate:
   ```yaml
   - name: test-gate
     gate: tests-pass
   - name: lint-gate
     gate: custom-command
     gateCommand: "eslint ."
   ```

3. **Add a new binary to the allowlist via PR** (requires security review).
   The allowlist lives in `src/cli/run.ts` as `ALLOWED_GATE_BINARIES`.

If your workflow used a non-allowlisted binary (e.g. `gateCommand: "curl ..."`),
the workflow will now fail immediately at the gate step with an error message
listing the allowlist. There is no auto-migration path — explicit user action
is required.

## [0.2.0] — 2026-05-10

### Breaking

- **`mcp__dev-workflow__memory_store` now throws daemon errors instead of returning silent `{id: null}`.**
  User-invoked `memory_store` calls surface daemon failures (Voyage 403, daemon offline,
  embedding API unavailable) via JSON-RPC `isError: true` so the caller agent can react.
  Auto-mirror callers (`vault_record` / `vault_knowledge` / `vault_pattern` /
  `EngramBridge.afterStep`) keep silent fail-safe — vault file remains source of truth.
  See **Migration guide** below. (`5f1b03c`, ADR 2026-05-06)

- **Removed hooks `post-edit` and `pre-compact`** from the bundled `.claude/settings.json`
  template. Active hooks are now: `SessionStart`, `SessionEnd`, `TaskCompleted`. (`a9d2785`)

- **Engram socket resolution is now per-project**, not global.
  Priority: `ENGRAM_SOCKET_PATH` env → `<project>/.engram/engram.sock` →
  `$HOME/.engram/engram.sock` (legacy fallback). Existing memories in `~/.engram/engram.db`
  remain inaccessible from per-project daemons until you run `engram migrate` from the
  project root. (`8b5ba63`)

- **Engram daemon tag wire format changed to native JSON array.**
  After upstream daemon variant B release, `tags` parameter on `memory_search` /
  `memory_store` / `memory_judge` is sent as native array (was `JSON.stringify`'d
  string). Downstream agents using `mcp__dev-workflow__memory_*` are unaffected
  (proxy normalizes); only direct `mcp__engram__memory_*` callers may need updates.
  (`ecdea0e`, `2260cb8`)

### Added

- **11-step `/workflow:dev` pipeline with `PLAN_FIX` step.**
  When `plan-review` returns `Verdict: NEEDS_REVISION` + `Next: plan-fix`, a Full
  coder subagent applies surgical Edits to the saved plan via `PLAN_REMARKS`
  (vs full regen-from-scratch via planner). Verdict-aware `user-approve` gate:
  `NEEDS_REVISION` blocks gate regardless of user input (silent corruption guard).
  Runtime `Next:` directive whitelist: only `coder` agent ending in `-fix` can be
  routed to dynamically. (`3016a6f`, ADR 2026-05-05)

- **Engram MCP proxy** — three new tools with auto-decoration of pipeline context:
  - `mcp__dev-workflow__memory_search` — auto-tags `step:`, `branch:`, `run:`, `task:`
  - `mcp__dev-workflow__memory_store` — same, **strict** variant (throws on daemon error)
  - `mcp__dev-workflow__memory_judge` — score 0.0–1.0 for Q-learning router

  Direct `mcp__engram__memory_*` remains an escape hatch for explicit project / tags
  control. (`110d7d3`, `5f1b03c`, ADR 2026-04-30)

- **Engram learning loop** — `vault_record(adr|debt|bug)` is auto-mirrored to engram
  with content-hash idempotency. Telemetry counters `{search, store, judge, vaultRecord,
  skipped}` on `WorkflowRun`; `session-end` hook warns when `vault_record > 0` but
  `store == 0`. Tag injection guards (`,` / `\n` rejected at MCP boundary). (`0c4fb4d`,
  ADR 2026-05-01)

- **Engram observability** — `ENGRAM_TRACE_FILE` env var enables JSONL tracing of
  every `socketCall` (capture: `{ts, method, params, ok, response_summary,
  duration_ms, error?}`). `WorkflowEngine.start()` auto-sets the path to
  `<vault>/workflow-state/runs/<runId>.engram-trace.jsonl` if not manually overridden.
  Subagent processes inherit the env var. New CLI: `dev-workflow engram-trace
  <runId> [--raw]`. (`602342b`, ADR 2026-05-01)

- **`vault_pattern` MCP tool** + **`/vault:pattern` slash command** —
  append-only writes to `conventions.md "## Patterns"` section with line-level
  deduplication. (`0283dea`, ADR 2026-04-23)

- **`workflow_create` MCP tool** + **`/workflow:create` interview slash** —
  guided creation of custom `.dev-vault/workflows/<name>.yaml`. (`2b81f30`)

- **`/vault:upgrade` slash command** — agent-driven safe template sync from the
  installed package to the project's `.claude/`. Two-phase plan/apply, ms-precision
  backup, security-hardened (path traversal pre-fence, shell-quoting, symlink
  detection, `__proto__` guard, `.lock` concurrent guard). (`4f3fd2a`, ADR 2026-04-29)

- **CLI oracle commands** for bundled package paths (works correctly with
  `npm link` / `pnpm link --global` / dogfooding):
  - `dev-workflow templates-root` — absolute path to bundled `templates/` (`18521c9`)
  - `dev-workflow settings-template` — bundled `.claude/settings.json` JSON (`e6e724d`)
  - `dev-workflow spec-template` — bundled `SPEC.md` Mirror Skeleton (`a52f94b`)

- **Unified workflow dispatcher** — all `/workflow:*` slashes are thin shims (~14
  lines) delegating to `templates/claude/commands/workflow/_dispatch.md` (~334 lines).
  5 builtin YAML templates (`dev`, `hotfix`, `review`, `test`, `intake`).
  Custom-first routing: `.dev-vault/workflows/*.yaml` shadow builtins. Auto-generated
  shims for custom workflows via `session-start` hook. `dev-workflow validate`
  performs 5 static checks (workflow name, output block format, stepFile path
  safety, onFail target existence, dev-class workflows have vault-updates step).
  (`d5affaa`, `8c6f523`, `53c9037`, `d2784d1`, `2f80f3f`, `7980345`, `9ad59aa`,
  `11e9805`, `2b81f30`)

- **VERIFY consistency check** — verifier scans adjacent docs / headers /
  help-text for stale references after surface changes. **COMMIT heredoc rule** —
  commit messages with backticks must use `git commit -F - <<'EOF'` pattern to
  prevent command substitution. (`ac861b9`)

### Changed

- **Engram `REQUEST_TIMEOUT_MS`: 2000 → 5000ms.** Daemon embedding generation via
  Voyage AI takes 1.6–2.8 s steady-state, up to 4.7 s cold (HTTPS roundtrip + HNSW +
  reqwest::Client cold-init). Old timeout caused ~50% silent timeouts → fail-safe
  `[]` results. (`804abc8`, ADR 2026-05-05)

- **`engramHealth()` switched** from removed `memory_health` daemon endpoint to
  `memory_status`. `modelsStale` is inferred from `hints[]` array. (`804abc8`)

- **Documentation surface synchronized** with current code state:
  README + 8 website mdx files (counts, pipeline steps, new sections for Voyage AI
  dependency, engram per-project socket, `engramStoreStrict` asymmetry, MCP proxy
  auto-decoration). (`82b5b80`, `9531ba9`)

### Removed

- **`memory_health` engram endpoint usage.** Daemon API breaking change upstream;
  replaced with `memory_status`. (`804abc8`)

- **Cold-start `engramSearch("warmup")` from `session-start` hook.** Was based on
  incorrect "lazy vector index init" hypothesis; real cause was Voyage API latency
  exceeding the old 2 s timeout. Warmup itself was timing out. Replaced by raised
  `REQUEST_TIMEOUT_MS`. (`804abc8`, supersedes warmup surface in `602342b`)

- **Static `templates/claude/settings.json`.** Generated dynamically via
  `dev-workflow settings-template` CLI to ensure absolute paths bind to the
  installed package location. (`e6e724d`)

### Fixed

- **`/vault:upgrade` resolves bundled `templates/` correctly under `npm link`** —
  4-attempt CLI oracle chain (direct → npx → pnpm exec → legacy `npm root`).
  (`18521c9`)

- **Engram socket isolation** — code no longer connects to global `$HOME/.engram/`
  daemon when a per-project daemon is intended. Bonus: surfaced pre-existing test
  isolation flaw (mcp.test.ts + session-start.test.ts silently connecting to real
  engram daemon). (`8b5ba63`)

- **Engram tag wire format** — three iterations to land on native array
  matching daemon variant B contract. (`ecdea0e` CSV→JSON-string,
  `2260cb8` JSON-string→native array)

### Docs

- README MCP tools count 13/14 → 20, pipeline 10 → 11 шагов, new bullets for
  engram memory + Voyage AI semantic search.
- 8 website mdx pages updated (index, quality/pipeline, commands/workflow,
  commands/cli, concepts/workflows, concepts/intelligence, installation, mcp/tools).
- New website section `concepts/intelligence.mdx ## Engram — долгосрочная память`
  with Voyage AI dependency disclosure (cost, privacy, fallback, cold-start latency).
- Landing page (`website/app/page.tsx`) stats and pipeline visualization synced.

### Migration guide

#### `memory_store` now throws on daemon errors

Before 0.2.0: `mcp__dev-workflow__memory_store` returned `{id: null}` silently
when the engram daemon was unavailable, mis-configured, or returned an error.
Agents had no signal to react.

In 0.2.0: the same call **throws** through JSON-RPC `isError: true`. The error
message is prefixed `engram memory_store:` and includes the daemon's original
message (e.g. `engram memory_store: HTTP 403 Unauthorized`).

If your downstream agent or tool wrapper depends on the silent behavior:

1. **Recommended** — wrap the call in `try { ... } catch { ... }` and
   handle the error explicitly. Common remediation paths surface in the message:
   - `HTTP 403 / Unauthorized` → rotate Voyage AI API key in
     `~/.engram/engram.toml` `[embedding].api_key`, restart daemon
   - `embedding api unavailable` / `connection refused` → check daemon, network,
     or temporarily switch to `[embedding].provider = "deterministic"` (offline,
     hash-based, no semantic quality)
   - daemon stopped → `engram server` from the project root

2. **Escape hatch** — call `mcp__engram__memory_*` directly. The direct engram
   tools are unchanged and still silent-on-failure. Note: direct tools do NOT
   auto-decorate with pipeline context tags (`step:` / `branch:` / `run:` /
   `task:`); you must pass tags manually.

3. **Auto-mirror unaffected** — `vault_record` / `vault_knowledge` /
   `vault_pattern` continue to mirror to engram silently. Vault file write
   succeeds even if the mirror fails; vault is the source of truth.

#### Engram per-project socket

If you previously had memories in `~/.engram/engram.db`, after upgrading engram
itself to per-project deploy, run:

```bash
cd <project-root>
engram migrate
```

This copies legacy global memories into `<project>/.engram/engram.db`. Until
migration runs, `mcp__dev-workflow__memory_search` from inside `<project>/`
will not find legacy entries.

#### Pipeline now has 11 steps (PLAN_FIX inserted)

If you have custom YAML workflows (`.dev-vault/workflows/<name>.yaml`) that
reference step numbers, the `dev` workflow grew from 10 to 11 named steps.
PLAN_FIX is inserted between PLAN_REVIEW and CODE. If your custom workflow
uses `onFail: plan-fix`, the target now exists; if you reference step names
explicitly elsewhere (e.g. in step files or hooks), update accordingly.

`dev-workflow validate` (which runs in `session-start` and on demand) will
warn about stale references — re-run it after upgrading.

[0.2.0]: https://github.com/supostat/dev-workflow/compare/v0.1.7...v0.2.0
[0.1.7]: https://github.com/supostat/dev-workflow/releases/tag/v0.1.7

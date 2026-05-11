# Changelog

All notable changes to `@engramm/dev-workflow` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

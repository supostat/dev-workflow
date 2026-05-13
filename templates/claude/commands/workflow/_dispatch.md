# Generic workflow dispatcher

Shared orchestration logic for all `/workflow:*` commands. Shim files under
`.claude/commands/workflow/<name>.md` delegate here by saying:

> Apply `_dispatch.md` with workflow=`<name>`, args=`<user args>`.

This file is an internal reference — you should not need to invoke
`/workflow:_dispatch` directly. Use `/workflow:dev`, `/workflow:hotfix`, or a
custom `/workflow:<your-flow>` instead.

## Input contract

- `workflow`: string — name of the workflow to run (e.g. `dev`, `hotfix`,
  or a custom name from `.dev-vault/workflows/<name>.yaml`)
- `args`: string — raw user arguments following the slash-command

`args` may contain:
- a free-form task description, or
- a path to a `.md` / `.txt` file holding the task, or
- a task ID matching `.dev-vault/tasks/task-*.md`
- the `--auto-commit` flag anywhere in args switches to autonomous mode

## Output language

All user-facing output (display blocks, verdicts, summaries, questions) MUST
be in Russian (ru-RU). Internal protocol blocks (CONTEXT, PLAN, CODE_DONE,
REVIEW, VERIFY, or user-defined outputBlock names) stay in English.

## Workflow routing

Resolve the concrete workflow YAML in this order:

1. **Custom pipeline:** `.dev-vault/workflows/<workflow>.yaml` — if present,
   use it. Custom-first priority (ADR 2026-04-22) lets a project fully
   override a builtin by shadowing its name.
2. **Builtin pipeline:** `templates/workflows/<workflow>.yaml` — if present.
3. **Match by files:** if `workflow` argument does not name a file, read all
   YAMLs above and check their `match` field (glob patterns). If `args`
   mentions files matching a pipeline's `match`, use that pipeline. If
   multiple match, ask the user to disambiguate.
4. **Fallback:** if nothing resolves, abort with the list of available
   workflow names.

## Mode detection

If `args` begins with a file path, read the file and detect mode:

- **Single task** (no `## Tasks` section, or exactly one item) → **Normal mode**
- **Phase file** (has `## Tasks` with 2+ items, or `phase:` in frontmatter)
  → **Phase mode**

Otherwise — Normal mode, with `args` treated as the task description.

If `args` is a task ID (`task-*`), read the corresponding file in
`.dev-vault/tasks/` to get the title and description, then Normal mode.

## Step resolution

For each step in `workflow.steps` (from YAML), resolve the orchestration
markdown (the prompt that tells the orchestrator how to run this step):

1. **Explicit `stepFile:`** — if the step has a `stepFile` field, resolve it
   relative to the project root.
   - Reject if matches `/\.\./` (contains `..` segment) — path traversal guard.
   - Reject if matches `/^\//` (absolute path).
   - After `path.resolve`, assert the result is inside `.dev-vault/` or
     `templates/claude/commands/workflow/steps/`. Reject otherwise.
2. **User step-pool:** `.dev-vault/workflow-steps/<step.name>.md` — if
   present, use it. This lets a project override a builtin step (e.g.
   customize the `plan` prompt) without forking templates.
3. **Builtin table** — fall back to the table below, keyed by `step.agent`:

   | Agent name | Step file | Notes |
   |------------|-----------|-------|
   | reader | steps/read.md | Context gathering |
   | planner | steps/plan.md | Architecture + pseudo-code |
   | plan-reviewer | steps/plan-review.md | 9-criteria plan review + emits `Verdict:` and `Next:` directives |
   | coder | steps/coder.md, steps/plan-fix.md | Implementation (also serves plan-fix step in PLAN_FIX mode) |
   | reviewer | steps/review.md | 3 parallel reviewers |
   | tester | steps/test.md | Build + test gate |
   | verifier | steps/verify.md | Task compliance check |
   | committer | steps/commit.md | Git operations |
   | *custom agent* | read `.dev-vault/agents/<agent>.md` and use its system prompt | |

   **Orchestrator-only steps (no subagent launched):**

   | Step name | Step file | Notes |
   |-----------|-----------|-------|
   | preflight | steps/preflight.md | Baseline check + phase-mode task creation (orchestrator runs directly) |
   | vault-updates | steps/vault-updates.md | Daily log + task status + vault record append (orchestrator runs directly via MCP) |

   These steps are declared in YAML like any other but their step file
   instructs the orchestrator itself — no `Launch subagent` phase.

4. **Abort** — if none of the above resolves, error: `step "<name>" cannot be
   resolved: no stepFile, no .dev-vault/workflow-steps/<name>.md, agent
   "<agent>" not in builtin table or .dev-vault/agents/`.

## Subagent resolution

For each step, determine the subagent type:

1. **Explicit `subagent:` in YAML** — use that (`Explore` / `Full` / `bash`).
2. **Builtin table** — if the step's `agent` is in the table above:
   - reader, planner, plan-reviewer, reviewer, verifier → `Explore`
   - coder, committer → `Full`
   - tester → `bash` (orchestrator runs build/test directly)
3. **Custom agent permissions** — read `.dev-vault/agents/<agent>.md`
   frontmatter:
   - `write: []` (empty) → `Explore` (read-only)
   - `write: [<pattern>, ...]` (non-empty) → `Full`

Orchestrator-only steps (`preflight`, `vault-updates`) have no subagent —
the orchestrator executes their step file directly.

Enforcement algorithm (used at Step execution):
1. Resolve subagent type via rules above.
2. Map `step.agent` (or step name for orchestrator-only) to the permission
   matrix row below.
3. Assert subagent type compatible with the row (e.g. `reader` must be
   `Explore`; `coder` must be `Full`). Abort on mismatch.

## Output block resolution

Each subagent emits a named block at the end of its output (CONTEXT:, PLAN:,
CODE_DONE:, REVIEW:, VERIFY:, etc). The orchestrator parses that block and
passes it to downstream steps via their `input:` field.

For each step:

1. **Explicit `outputBlock:` in YAML** — subagent emits a block with that
   name. Validate the value against `/^[A-Z][A-Z0-9_]{1,64}$/` (UPPER_SNAKE,
   2–64 chars). Reject otherwise — this prevents prompt-injection via
   non-block markdown (`#`, `*`, backticks).
2. **Default per step type** — if not specified, use the builtin default
   from the step file (CONTEXT for reader, PLAN for planner, CODE_DONE for
   coder, REVIEW_SECURITY/REVIEW_QUALITY/REVIEW_COVERAGE for the three
   reviewers, TEST for tester, VERIFY for verifier, COMMIT for committer).

## Gate semantics

Apply `step.gate` from YAML after the subagent completes:

- `none` — auto-advance to the next step
- `user-approve` — show the subagent output, ask the user yes/no.
  **Verdict-aware override (ADR 2026-05-05):** if the output contains a
  line `Verdict: NEEDS_REVISION` (exact match, line-anchored), engine treats
  this as gate failure regardless of user input. Prevents silent corruption
  where reviewer flags plan but user accidentally clicks Yes.
- `tests-pass` — orchestrator runs the project's build+test commands; gate
  passes iff both exit 0
- `review-pass` — scan the output for `CRITICAL` or `HIGH` severity markers;
  gate passes iff none are found
- `custom-command` — run `step.gateCommand` as bash; gate passes iff exit 0.
  **`gateCommand` is user-supplied shell** — validation before execution
  is deferred to `dev-workflow validate` (see debt
  `2026-04-22-loaderts--missing-validation-on-gatecommand-agent-onfail.md`).

### Failure handling

- On gate failure, apply `step.onFail`:
  - `null` (default) — abort pipeline
  - `"<step-name>"` — redirect to that step for a retry
- **Runtime `Next:` directive override (ADR 2026-05-05):** if the failed
  step's output contains `Next: <step-name>` (kebab-case, line-anchored)
  AND the target is **whitelisted** (agent === "coder" AND name ends with
  `-fix`), engine routes to that target instead of the static onFail. If
  Next points to a non-whitelisted step (e.g., `commit`, `test`), engine
  logs to stderr and falls back to the static onFail target. This enables
  conditional routing: architecture changes → planner re-entry; detail
  fixes → fix-class step like `plan-fix`.
- If the resolved target step does not exist in `workflow.steps`, engine
  gracefully fails the run (status=failed, stderr log, state saved). No
  uncaught exceptions.
- `step.maxAttempts` (default 3) caps retries per step. The attempt counter
  on a re-entered step is **NOT reset** — total budget across the cycle is
  global (defends against infinite re-entry loops in cyclic onFail edges).
- After limit:
  - **Interactive mode** — ask the user whether to proceed, retry, or abort
  - **Autonomous mode** (`--auto-commit`) — abort without commit

## Commit mode

| Mode | Flag | Commit | Gate-limit behavior |
|------|------|--------|---------------------|
| Interactive (default) | — | Ask user | Ask user |
| Autonomous | `--auto-commit` | Auto-commit | Stop without commit |

## Permission matrix (violation = ABORT)

```
Agent          Read   Write   Bash              Subagent
─────────────  ─────  ──────  ────────────────  ────────
reader         yes    no      no                Explore
planner        yes    no      no                Explore
plan-reviewer  yes    no      no                Explore
coder          yes    yes     build/test        Full
reviewer x3    yes    no      no                Explore
tester         no     no      build/test        bash (orchestrator)
verifier       yes    no      no                Explore
committer      no     no      git only          Full
```

Orchestrator-only steps:

```
Step           Read   Write (files)   Bash              Vault writes
─────────────  ─────  ──────────────  ────────────────  ────────────
preflight      yes    no              build/test        no
vault-updates  yes    no              no                yes (via MCP vault_record / vault_knowledge, Edit append)
```

Custom agents — permissions from their frontmatter (`read`, `write`,
`shell`, `git`). Orchestrator enforces subagent type based on `write:`
(see Subagent resolution).

## Start workflow run

After workflow routing has settled (the concrete YAML is resolved + mode
detected) but BEFORE the pipeline loop begins, the orchestrator MUST call
`mcp__dev-workflow__workflow_start` to register a run state file. The
returned `runId` threads through every subsequent `step_complete` call so
engram judgments correlate to the run.

```
Call: mcp__dev-workflow__workflow_start({
  workflowName: <resolved workflow name>,
  taskDescription: <task description from args / task file>,
  taskId: <task-NNN if args resolved to a vault task, else omit>,
})

Returns: { runId: "run-<12hex>", traceFilePath: "<vault>/workflow-state/runs/<runId>.engram-trace.jsonl" }

Capture `runId` — it is REQUIRED on every step_complete call below.
```

Validation errors (E001 invalid workflowName / E002 empty taskDescription /
E003 invalid taskId / E004 unknown workflow) abort the dispatch — surface
the error to the user and stop. No state is written on failure.

## Pipeline execution

### Normal mode

```
For each step in workflow.steps:
  1. Resolve orchestration markdown (Step resolution, above)
  2. Resolve subagent type (Subagent resolution, above)
  3. Build the subagent prompt from the step file, inserting:
     - vault sections (stack / conventions / knowledge / gameplan) as
       static context
     - blocks from previous steps listed in step.input
     - engram context block (from engram.memory_search before each step)
  4. Launch the subagent (or run bash for `bash` type)
  5. Parse the output: extract the named output block (step.outputBlock or
     default), save it keyed by `<step.name>.output` for downstream input:
     references
  6. Apply gate (Gate semantics, above)
  7. If gate fails, apply onFail/maxAttempts (Failure handling, above)

ON STOP (pipeline aborts at any step):
  Run the "vault-updates" step (if present in workflow.steps) before
  stopping, so findings/ADR/debt are recorded.
```

### Phase mode

```
Run the first "read/plan/plan-review" cluster once for the whole phase.
Then, for each subtask in the phase's ## Tasks section:
  Run the middle cluster (coder, review, test) once per subtask
Finally, run verify/commit/vault-updates once for the whole phase.

Which steps are "cluster" vs "per-subtask" is determined by step names:
- Pre-loop:   preflight, read, plan, plan-review
- Per-subtask: coder, review (and its fix loop via onFail), test,
  vault-updates (incremental)
- Post-loop: verify, commit (single commit for the whole phase),
  vault-updates (final)

If a workflow is used in phase mode but its YAML doesn't declare all of
these steps, skip missing ones; emit a warning in the final summary.
```

## ⚠️ Mandatory PREFLIGHT / VAULT-UPDATES — changed behavior

Previous behavior (pre-ADR 2026-04-22): orchestrator always ran PREFLIGHT
(Step 0) and VAULT-UPDATES (Step 9b) regardless of the pipeline, even if
the YAML didn't declare them.

**Current behavior:** these steps must be **explicitly declared** in the
workflow YAML. A workflow without a `vault-updates` step will happily run
and not record findings/ADR/debt — vault drift is possible.

Rationale: unified model requires one source of truth (YAML). The
hardcoded always-run contradicted that. `dev-workflow validate` (see
Task 7 in phase `unified-workflow-dispatcher`) warns when a dev-class
workflow (contains `coder` or `committer` agents) omits `vault-updates`.
Builtin templates (`templates/workflows/{dev,hotfix}.yaml`) include these
steps as reference.

## Enforcement

Before running any subagent, verify its subagent type is compatible with
the step's permissions per the matrix above. Concrete algorithm:

1. Resolve subagent type (Subagent resolution section).
2. Look up `step.agent` in the permission matrix.
3. Assert subagent type matches the matrix row.
4. At subagent launch, include the row's capabilities in the prompt; any
   tool invocation outside those capabilities aborts the step.

Violation → ABORT with message: `agent "<agent>" launched as "<subagent>"
but permission matrix allows "<expected>"`.

| Role | Subagent | On violation |
|------|----------|--------------|
| reader / planner / plan-reviewer / reviewer / verifier | Explore | Write/Bash → ABORT |
| coder | Full | git commit/push → ABORT |
| tester | bash (orchestrator) | N/A (orchestrator runs build/test) |
| committer | Full | Read/Write/non-git → ABORT |
| preflight (orchestrator-only) | — | Write → ABORT |
| vault-updates (orchestrator-only) | — | Non-vault writes → ABORT |

## Summary format

After the pipeline completes (or aborts), display as plain markdown (NOT
in a code fence). Do NOT wrap the summary in backticks — it renders as a
horizontally-scrolling monospace block.

Heading uses the workflow name, uppercased: `## <WORKFLOW NAME> COMPLETE`.
For example: **## DEV COMPLETE**, **## HOTFIX COMPLETE**, **## MY-FLOW COMPLETE**.

Body layout:

- **Workflow:** <name>
- **Task:** <description or task ID>
- **Mode:** interactive / autonomous
- **Scope:** small / large

### Agents

Enumerate each step in `workflow.steps` in order, one bullet per step:

- **<STEP NAME UPPERCASED>** [<subagent type>] — <one-line summary derived from the step's output / verdict>

### Findings (if any)

- Gotchas → knowledge.md
- Architecture concerns → knowledge.md

### Vault records (if any)

- ADR → .dev-vault/architecture/<slug>.md
- Bug → .dev-vault/bugs/<slug>.md
- Debt → .dev-vault/debt/<slug>.md

Do not hardcode the agent list — enumerate `workflow.steps`. A `hotfix`
summary shows 4 steps; a `review` summary shows 2; a custom workflow
shows whatever its YAML declares.

## Rules

- Before each step: read the resolved step file fresh. Do not rely on
  memory of previous steps.
- Orchestrator reads vault files (stack, conventions, knowledge, gameplan)
  once per pipeline and passes content to agents — do not re-read per step.
- Context passes between steps as named blocks (step-output keyed by
  `<step.name>.output`).
- Permission matrix is law. Explore agents only read.
- CODER is the only agent allowed to modify project files.
- REVIEWER never fixes code — only reports issues.
- COMMIT performs `git add` + `git diff` + `git commit`, nothing else.
- All vault writes use the `Edit` tool (append) or MCP `vault_record` /
  `vault_knowledge`, never `Write` on existing vault files (overwrite).

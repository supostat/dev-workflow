# /workflow:dev — Multi-agent development cycle

## Output language

All user-facing output (display blocks, verdicts, summaries, questions) MUST be in Russian (ru-RU).
Internal protocol blocks (CONTEXT, PLAN, CODE_DONE, REVIEW, VERIFY) stay in English.

## Arguments

`/workflow:dev <task>` — interactive mode (default, asks before commit).
`/workflow:dev <pipeline> <task>` — use specific pipeline from `.dev-vault/workflows/`.
`/workflow:dev <path>` — task from file (.md, .txt).
`/workflow:dev <task> --auto-commit` — autonomous mode (commits automatically, for swarm use).

## Pipeline routing

**Priority order:**

1. **Explicit pipeline:** if first argument matches a YAML file in `.dev-vault/workflows/<name>.yaml` → use it
2. **Match by files:** read all `.dev-vault/workflows/*.yaml`, check `match` field (glob patterns). If task mentions files matching a pipeline's `match` → use it. If multiple match → ask user.
3. **Fallback:** no custom pipelines found → use built-in Normal/Phase mode (hardcoded steps below)

**When using a custom pipeline:**
- Read the YAML to get step order, agents, gates, gateCommands, onFail, maxAttempts
- For each step, determine how to execute based on agent name:

| Agent name | Step file | Subagent | Notes |
|------------|-----------|----------|-------|
| reader | steps/read.md | Explore | Context gathering |
| planner | steps/plan.md | Explore | Architecture + pseudo-code |
| coder | steps/coder.md | Full | Implementation |
| reviewer | steps/review.md | Explore x3 | 3 parallel reviewers |
| tester | steps/test.md | bash | Build + test gate |
| committer | steps/commit.md | Full | Git operations |
| *custom agent* | read `.dev-vault/agents/<name>.md` | Explore (read-only) or Full (if write: non-empty) | Use agent's system prompt as instructions |

- Apply gate from YAML:
  - `none` → auto-advance
  - `user-approve` → show output, ask user
  - `tests-pass` → run build+test commands
  - `review-pass` → check for CRITICAL/HIGH in output
  - `custom-command` → run `gateCommand` from YAML, exit 0 = pass

- Apply `onFail` → redirect to specified step on gate failure
- Apply `maxAttempts` → limit retries, then ask user (interactive) or stop (autonomous)

**Always run PREFLIGHT (Step 0) and VAULT-UPDATES (Step 9b) regardless of pipeline.**

## Mode detection

If argument is a file path, read the file and detect mode:

- **Single task** (no `## Tasks` section or only 1 task) → **Normal mode**
- **Phase file** (has `## Tasks` with 2+ items, or has `phase:` in frontmatter) → **Phase mode**

## Commit mode

| Mode | Flag | Commit | Gates on limit |
|------|------|--------|---------------|
| **Interactive** (default) | — | Ask user | Ask user |
| **Autonomous** | `--auto-commit` | Auto-commit | Stop without commit |

## Permission matrix (violation = ABORT)

```
Agent          Read   Write   Bash              Subagent
─────────────  ─────  ──────  ────────────────  ────────
READ           yes    no      no                Explore
PLAN           yes    no      no                Explore
PLAN_REVIEW    yes    no      no                Explore
CODER          yes    yes     build/test        Full
REVIEW x3      yes    no      no                Explore
TEST           no     no      build/test        bash (orchestrator)
VERIFY         yes    no      no                Explore
COMMIT         no     no      git only          Full
```

## Pipeline

**IMPORTANT:** Before each step, READ the step file from `.claude/commands/workflow/steps/`. This gives you focused instructions for that specific step. Do NOT rely on memory of previous steps.

### Normal mode

```
Step 0:  Read steps/preflight.md   → execute PREFLIGHT
Step 1:  Read steps/read.md        → launch Explore agent → CONTEXT block
Step 2:  Read steps/plan.md        → launch Explore agent → PLAN block
Step 3:  Read steps/plan-review.md → launch Explore agent → APPROVED / NEEDS_REVISION
Step 4:  Read steps/coder.md       → launch Full agent    → CODE_DONE block
Step 5:  Read steps/review.md      → launch 3 Explore agents parallel → APPROVED / CHANGES_REQUESTED
Step 6:  If CHANGES_REQUESTED → re-read steps/coder.md (fix mode) → re-read steps/review.md. Max 3.
Step 7:  Read steps/test.md        → run build + lint + tests
Step 8:  Read steps/verify.md      → launch Explore agent → COMPLETE / INCOMPLETE
Step 9:  Read steps/commit.md      → stage + commit (interactive or autonomous)
Step 9b: Read steps/vault-updates.md → update daily log, task status

ON STOP (pipeline aborted at any step):
  Read steps/vault-updates.md → record findings, ADR, debt BEFORE stopping
```

### Phase mode

```
Step 0:  Read steps/preflight.md   → auto-create tasks + baseline
Step 1:  Read steps/read.md        → CONTEXT (full phase)
Step 2:  Read steps/plan.md        → PLAN with subtasks
Step 3:  Read steps/plan-review.md → APPROVED → save plan

For each subtask:
  Step 4:  Read steps/coder.md     → CODE (subtask)
  Step 5:  Read steps/review.md    → REVIEW x3 (subtask)
  Step 6:  Fix loop if needed
  Step 7:  Read steps/test.md      → TEST (all tests, catches regressions)
  Step 9b: Read steps/vault-updates.md → refresh vault for next subtask

Step 8:  Read steps/verify.md      → VERIFY (full phase)
Step 9:  Read steps/commit.md      → one commit for entire phase
Step 9b: Read steps/vault-updates.md → phase done, tasks done, gameplan updated
```

## Step file location

All step files are in: `.claude/commands/workflow/steps/`

```
steps/
  principles.md      ← engineering principles (inlined in plan, coder, review)
  preflight.md       ← Step 0: baseline + phase task creation
  read.md            ← Step 1: context gathering
  plan.md            ← Step 2: architecture analysis + pseudo-code
  plan-review.md     ← Step 3: 9 criteria review
  coder.md           ← Step 4: test-first implementation + fix mode
  review.md          ← Step 5: 3 parallel reviewers + aggregate + fix loop
  test.md            ← Step 7: mandatory build/lint/test gate
  verify.md          ← Step 8: task compliance check
  commit.md          ← Step 9: interactive or autonomous commit
  vault-updates.md   ← Step 9b: daily log, status updates, vault refresh
```

## Enforcement

| Agent | Subagent type | On violation |
|-------|--------------|--------------|
| READ | Explore | Write/Bash → ABORT |
| PLAN | Explore | Write/Bash → ABORT |
| PLAN_REVIEW | Explore | Write/Bash → ABORT |
| CODER | Full | git commit/push → ABORT |
| REVIEW x3 | Explore | Write/Bash → ABORT |
| TEST | bash (orchestrator) | N/A |
| VERIFY | Explore | Write/Bash → ABORT |
| COMMIT | Full | Read/Write/non-git → ABORT |

## Summary format

After pipeline completes:

```
═══════════════════════════════
          DEV COMPLETE
═══════════════════════════════

Task: [description]
Mode: [interactive / autonomous]
Scope: [small / large]

Agents:
  PREFLIGHT       [bash]         — [baseline]
  READ            [Explore]      — [N] files
  PLAN            [Explore]      — [N] files, pseudo-code
  PLAN_REVIEW     [Explore]      — [verdict]
  CODER           [Full]         — [N] changed, [N] created
  REVIEW:security [Explore]      — [verdict]
  REVIEW:quality  [Explore]      — [verdict]
  REVIEW:coverage [Explore]      — [verdict]
  TEST            [bash]         — [N] tests passed
  VERIFY          [Explore]      — [verdict]
  COMMIT          [git]          — [hash]

[If review found gotchas:]     Gotchas → knowledge.md
[If architecture concerns:]    Concerns → knowledge.md

Vault records auto-created:
  [If PLAN had deviations:]         ADR → .dev-vault/architecture/<slug>.md
  [If REVIEW CRITICAL/HIGH fixed:]  Bug → .dev-vault/bugs/<slug>.md
  [If CODER skipped MEDIUM:]        Debt → .dev-vault/debt/<slug>.md

═══════════════════════════════
```

## Rules

- Before each step: READ the step file, then execute. Fresh instructions each time.
- Orchestrator reads vault files ONCE (Step 1), passes CONTENT to agents
- Context passes as blocks (CONTEXT, PLAN, CODE_DONE, REVIEW)
- Permission matrix is law. Explore agents ONLY read.
- CODER is the only one who touches files
- REVIEWER never fixes code — only reports issues
- COMMIT — git add + git diff + git commit, nothing else
- All vault writes use Edit tool (append), never Write tool (overwrite)

# Step 8: VERIFY (task compliance check)

## Step 8.0: Engram search (orchestrator, BEFORE subagent)

Before launching the subagent, orchestrator MUST:

1. Call `mcp__dev-workflow__memory_search({ query: "verify " + taskDescription + " " + branch, project: projectName, limit: 5 })`.
2. Save `engramMemoryIds` and build `engramContextBlock`.
3. **Fail-safe:** if search unavailable, log `[engram] search skipped for Step 8`, set empty, continue.

## Step 8.1: Launch subagent

Launch **Explore** subagent:

```
You are a verification agent. Check if the implementation matches the ORIGINAL TASK.
Do NOT check code quality or security — that was already done.
Check ONLY: does the code do what was asked?

## Original task
[task from user — the ORIGINAL request, not the plan]

## Plan
[PLAN block]

## What was implemented
[final CODE_DONE or CODE_FIX block]

## Check
- Every requirement from the original task addressed?
- Any requirement missed or partially implemented?
- Any drift from the task? (implemented something not asked for)
- Acceptance criteria met? (if task specifies them)

## Consistency check (always run — surface drift detection)

Whenever new public surface is added or existing public surface changes, scan adjacent docs/headers/lists for stale references. Specifically:

1. **README** — if a CLI command, slash, MCP tool, agent, or workflow was added/renamed/removed, does the README list reflect it? Run `grep -n "dev-workflow \|/vault:\|/workflow:\|/git:\|/session:" README.md` and cross-check against the diff.
2. **Touched-file headers/intros** — for every file changed, re-read the first 10 lines. Do they describe the new behavior? Common drift: docstring mentioning the old API, slash header naming the old resolution path, comment block listing outdated steps.
3. **Help text / printHelp / usage strings** — `grep -n "printHelp\|usage\|Usage:" src/` — do they mention the new surface?
4. **CLAUDE.md / .claude/** project instructions — does any section reference behavior that just changed?
5. **Memory pointers** — if `MEMORY.md` or any memory file references the changed state by name (file path, function, version, command), is it still accurate?

Flag each stale reference as `INCONSISTENT: <file>:<line>` in the output. These are NOT separate from "Missing" — they are missed requirements (the task implicitly includes keeping the surface consistent).

## Mid-work discoveries (MANDATORY before END_VERIFY)

If you discovered something non-obvious that does NOT warrant vault_record (workaround, library API surprise, edge case, framework quirk) — call `mcp__dev-workflow__memory_store` BEFORE emitting your output block.

Type guidance:
- `antipattern`: behavior that broke or surprised ("X does NOT do Y")
- `pattern`: technique that worked, especially when contextual

Examples (from BossBots TASK-048/049):

```
// Antipattern — library surprise
mcp__dev-workflow__memory_store({
  context: "NestJS DI rejects type-alias constructor params with default values",
  action: "Type alias with default value rejected — DI expects class/primitive token",
  result: "Workaround: inline the type or use explicit class",
  type: "antipattern",
  tags: ["nestjs", "di"],
})

// Pattern — security-relevant snippet
mcp__dev-workflow__memory_store({
  context: "fetch SSRF mitigation against redirect-to-private-IP",
  action: "Pass redirect: 'error' to fetch — rejects 3xx Location header redirects",
  result: "Closes SSRF window after URL validated but before response read",
  type: "pattern",
  tags: ["security", "ssrf", "fetch"],
})

// Antipattern + mitigation
mcp__dev-workflow__memory_store({
  context: "@nestjs/schedule does NOT serialize overlapping cron ticks",
  action: "Discovered: scheduler invokes overlapping job instances concurrently",
  result: "Mitigation: BullMQ or per-job concurrency lock",
  type: "antipattern",
  tags: ["nestjs", "scheduler", "concurrency"],
})
```

When NOT to store:
- The fact will go via `vault_record(adr|debt|bug)` — auto-mirrored to engram, do not duplicate
- The fact will go via `vault_knowledge` / `vault_pattern` — already mirrored
- Trivial / obvious things ("variable renamed", "import added")

## Output Format
VERIFY:
Verdict: [COMPLETE / INCOMPLETE]
Addressed:
- [requirement] — implemented
Missing:
- [requirement not implemented — how to fix]
Inconsistent:
- [file:line — stale reference contradicting new behavior — fix]
Drift:
- [implementation not in original task — flag for user]
END_VERIFY

## Engram Memory
[engramContextBlock]

## Engram Feedback (MANDATORY — AFTER END_VERIFY)

Retrieved memories:
[engramMemoryIds as bullets, or "(none)"]

Judgments (format: `- <memory_id>: <score 0.0-1.0> — <explanation>`):
```

## Step 8.2: Parse feedback + judge (orchestrator, AFTER subagent)

After subagent returns `output`:

1. `mcp__dev-workflow__parse_engram_feedback({ output, expectedMemoryIds: engramMemoryIds })`.
2. Per judgment: `mcp__dev-workflow__memory_judge({ memory_id, score, explanation })`.
3. Per fallback id: `mcp__dev-workflow__memory_judge({ memory_id, score: 0.5, explanation: "No agent feedback" })`.
4. **Fail-safe:** if tools unavailable, log `[engram] feedback skipped for Step 8`. Continue.

**COMPLETE** → Step 9.

**INCOMPLETE** → pass missing items to CODER. **Max 2 iterations.** After limit:
- **Interactive:** show gaps, ask user whether to commit partial or stop
- **Autonomous:** stop without commit. Incomplete implementation = no commit.

Display as plain markdown (NOT in a code fence):

## VERIFY

- **Verdict:** COMPLETE / INCOMPLETE
- **If incomplete:** Missing [N] requirements

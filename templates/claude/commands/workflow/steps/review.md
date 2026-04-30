# Step 5: REVIEW (3 specialized reviewers in parallel)

## Step 5.0: Engram search (orchestrator, BEFORE subagents)

Before launching reviewers, orchestrator MUST:

1. Call `mcp__dev-workflow__memory_search({ query: "review " + taskDescription + " " + branch, project: projectName, limit: 5 })`.
2. Save `engramMemoryIds = results.map(m => m.id)` and build `engramContextBlock`.
3. The SAME memory set is shared across all 3 reviewers — each reviewer provides their own judgments in their own output.
4. **Fail-safe:** if search unavailable, log `[engram] search skipped for Step 5`, set `engramMemoryIds = []`, continue.

Then run `git diff` to capture actual changes.
Pass CODE_DONE summary + diff + `engramContextBlock` + `engramMemoryIds` to each reviewer.

Launch **3 Explore subagents in parallel** (one Agent call with 3 tool uses):

## REVIEW:security

```
You are a SECURITY reviewer. NEVER modify code — only report issues.
Focus EXCLUSIVELY on security. Ignore style, naming, structure.

## What coder did
[CODE_DONE or CODE_FIX block — summary]

## Actual diff
[git diff output — the real changes]

## Security guidelines
[.dev-vault/knowledge.md — Security section]

## Check (security ONLY)
- Injection (SQL, command, path traversal)
- XSS (unescaped user input)
- Hardcoded secrets, API keys, credentials
- Missing authentication/authorization
- Insecure deserialization
- Missing input validation at system boundaries
- Timing attacks, race conditions

## Severity
CRITICAL: vulnerability, data loss
HIGH: missing auth, missing validation on boundary
MEDIUM: defense-in-depth improvement
LOW: theoretical risk

## Output Format
REVIEW_SECURITY:
Verdict: [PASS / FAIL]
Issues:
- [SEVERITY]: [file]:[line] — [issue + fix]
END_REVIEW_SECURITY

## Engram Memory
[engramContextBlock]

## Engram Feedback (MANDATORY — AFTER END_REVIEW_SECURITY marker)

Retrieved memories:
[engramMemoryIds as bullets, or "(none)"]

Judgments (format: `- <memory_id>: <score 0.0-1.0> — <explanation>`):
```

## REVIEW:quality

```
You are a QUALITY reviewer. NEVER modify code — only report issues.
Focus EXCLUSIVELY on code quality and conventions. Ignore security.

## Plan
[PLAN block]

## What coder did
[CODE_DONE or CODE_FIX block — summary]

## Actual diff
[git diff output — the real changes]

## Conventions
[.dev-vault/conventions.md content]

## Engineering Principles
- Single Responsibility, Dependency Rule (inward), explicit dependencies
- Fail fast at boundaries, every error path tested, no silent catch
- No TODO/FIXME, no debug logging, no hardcoded config
- Max 300 lines/file, 30 lines/function, composition over inheritance
- No god objects, no utility dumps (helpers/, utils/)
- Test behaviour not implementation

## Check (quality ONLY)
- Plan adherence — everything implemented? Nothing extra?
- Conventions — naming, error handling, structure per project
- Architecture — single responsibility? correct layer? dependency direction inward?
- God objects — does any file/class know too much or do too many things?
- Abstractions — premature (interface with one impl)? missing (pattern repeated 3+ times)?
- Production readiness — TODOs? debug logging? hardcoded config? missing timeouts?
- Duplication — DRY violations
- Complexity — unnecessary abstractions, over-engineering
- Dead code — unused imports, unreachable branches
- Edge cases — null/undefined, empty arrays, boundary values

## Severity
CRITICAL: logic bug, data loss
HIGH: convention violation, plan deviation
MEDIUM: quality improvement
LOW: style nit

## Output Format
REVIEW_QUALITY:
Verdict: [PASS / FAIL]
Issues:
- [SEVERITY]: [file]:[line] — [issue + fix]
END_REVIEW_QUALITY

## Engram Memory
[engramContextBlock]

## Engram Feedback (MANDATORY — AFTER END_REVIEW_QUALITY marker)

Retrieved memories:
[engramMemoryIds as bullets, or "(none)"]

Judgments (format: `- <memory_id>: <score 0.0-1.0> — <explanation>`):
```

## REVIEW:coverage

```
You are a TEST COVERAGE reviewer. NEVER modify code — only report issues.
Focus EXCLUSIVELY on test adequacy. Ignore security and style.

## Plan
[PLAN block — Tests section]

## What coder did
[CODE_DONE or CODE_FIX block — summary]

## Actual diff
[git diff output — the real changes]

## Check (coverage ONLY)
- All planned tests written?
- Happy path covered?
- Edge cases covered? (empty input, boundary values, null)
- Error paths covered? (network failure, invalid input, permissions)
- Assertions meaningful? (not just "no throw")
- Test isolation? (no shared state between tests)

## Severity
CRITICAL: core logic untested
HIGH: missing edge case test for public API
MEDIUM: missing error path test
LOW: test could be more descriptive

## Output Format
REVIEW_COVERAGE:
Verdict: [PASS / FAIL]
Issues:
- [SEVERITY]: [file]:[line] — [issue + fix]
END_REVIEW_COVERAGE

## Engram Memory
[engramContextBlock]

## Engram Feedback (MANDATORY — AFTER END_REVIEW_COVERAGE marker)

Retrieved memories:
[engramMemoryIds as bullets, or "(none)"]

Judgments (format: `- <memory_id>: <score 0.0-1.0> — <explanation>`):
```

## Step 5.2: Parse feedback + judge (orchestrator, AFTER all 3 reviewers)

After all 3 reviewers return their outputs (security, quality, coverage):

1. For EACH reviewer output, call `mcp__dev-workflow__parse_engram_feedback({ output, expectedMemoryIds: engramMemoryIds })`.
2. Three reviewers × same memory set = 3 judgments per memory. Apply each: `mcp__dev-workflow__memory_judge({ memory_id, score, explanation })`. Engram daemon will aggregate.
3. For IDs in `fallbackIds` of ALL 3 reviewers (i.e., no reviewer judged): `mcp__dev-workflow__memory_judge({ memory_id: id, score: 0.5, explanation: "No agent feedback from any reviewer" })`.
4. **Fail-safe:** if tools unavailable, log `[engram] feedback skipped for Step 5`. Continue.

## Step 5.3: Extract gate body (orchestrator, BEFORE gate check)

Before running review-pass gate check on the aggregated review output:
- For EACH reviewer output, strip its `## Engram Feedback` section (split on `/^##\s+Engram Feedback/im`, keep body before).
- Run `checkReviewPass` only on the combined bodies (no engram sections).

This prevents explanation text like "severity: high" inside Engram judgments from failing gate.

## Aggregate

Merge all 3 REVIEW blocks into one verdict:
- Any CRITICAL or HIGH from ANY reviewer → **CHANGES_REQUESTED**
- All PASS with only MEDIUM/LOW → **APPROVED**

**Extract vault-worthy findings:**
- Gotchas → append to `.dev-vault/knowledge.md` section "Gotchas"
- Architecture concerns → append to `.dev-vault/knowledge.md` section "Architecture"
- New conventions → `mcp__dev-workflow__vault_pattern({ content: "- <finding>" })` (default section "Patterns"; dedup automatic)
Only findings useful for future sessions. Not bugs (fixed by coder), not style nits.

Display as plain markdown (NOT in a code fence):

## REVIEW (iteration [N])

- **Security:** PASS / FAIL [Critical: N, High: N]
- **Quality:** PASS / FAIL [Critical: N, High: N]
- **Coverage:** PASS / FAIL [Critical: N, High: N]
- **Verdict:** APPROVED / CHANGES_REQUESTED

## CODER↔REVIEW loop

**APPROVED** → Step 7 (TEST).

**CHANGES_REQUESTED** → read steps/coder.md, launch CODER in fix mode. Then re-review.

**Limit: 3 iterations.**

After limit:
- **Interactive:** ask: accept and commit / stop without commit
- **Autonomous:** stop without commit, stash changes.

# Step 5: REVIEW (3 specialized reviewers in parallel)

Before launching reviewers, orchestrator runs `git diff` to capture actual changes.
Pass BOTH the CODE_DONE summary AND the real diff to each reviewer.

## Engram (orchestrator — before launching reviewers)
Search for known antipatterns in affected modules:
memory_search(query="<changed modules> antipattern review")
Pass relevant antipatterns to reviewers as additional context in their prompts.

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
```

## Aggregate

Merge all 3 REVIEW blocks into one verdict:
- Any CRITICAL or HIGH from ANY reviewer → **CHANGES_REQUESTED**
- All PASS with only MEDIUM/LOW → **APPROVED**

**Extract vault-worthy findings:**
- Gotchas → append to `.dev-vault/knowledge.md` section "Gotchas"
- Architecture concerns → append to `.dev-vault/knowledge.md` section "Architecture"
- New conventions → append to `.dev-vault/conventions.md` section "Patterns"
Only findings useful for future sessions. Not bugs (fixed by coder), not style nits.

**Engram store (after aggregate):**
- CRITICAL/HIGH findings → memory_store(type: "antipattern", context: "<file:line — issue>", action: "<what was wrong>", result: "<how to fix>", tags: "<module>,review")
- Discovered gotchas → memory_store(type: "pattern", context: "<gotcha>", action: "<why it matters>", result: "<how to avoid>", tags: "<module>,review")

Display:

```
── REVIEW (iteration [N]) ──
  Security: PASS / FAIL [Critical: N, High: N]
  Quality:  PASS / FAIL [Critical: N, High: N]
  Coverage: PASS / FAIL [Critical: N, High: N]
Verdict: APPROVED / CHANGES_REQUESTED
```

## CODER↔REVIEW loop

**APPROVED** → Step 7 (TEST).

**CHANGES_REQUESTED** → read steps/coder.md, launch CODER in fix mode. Then re-review.

**Limit: 3 iterations.**

After limit:
- **Interactive:** ask: accept and commit / stop without commit
- **Autonomous:** stop without commit, stash changes.

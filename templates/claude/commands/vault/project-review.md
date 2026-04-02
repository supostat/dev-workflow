# /vault:project-review — Full project audit

Read-only comprehensive audit of the project. Checks vault, architecture, tests, security, debt, conventions, and production readiness. Does NOT modify any files.

## Permissions

- Read files: YES
- Write/Edit files: FORBIDDEN
- Bash: ONLY `npm test`, `npm run build`, `npm run lint` (or stack equivalent) — for checking, not fixing

## Procedure

### Step 1: Load vault context

MUST read ALL vault files:
- `.dev-vault/stack.md`
- `.dev-vault/conventions.md`
- `.dev-vault/knowledge.md`
- `.dev-vault/gameplan.md`
- `.dev-vault/phases/` — all phase files (check status: done/pending)
- `.dev-vault/tasks/` — all tasks (check statuses)
- `.dev-vault/architecture/` — all ADR records
- `.dev-vault/bugs/` — all bug records
- `.dev-vault/debt/` — all debt records

### Step 2: Scan codebase

Use Agent (Explore subagent) to:
1. Map project structure (top-level dirs, file count per dir)
2. Read 15-20 representative files (entry points, core modules, tests, configs)
3. Run `npm test` (or stack equivalent) — record pass/fail count
4. Run `npm run build` — record success/failure
5. Search for: TODO, FIXME, HACK, console.log, hardcoded secrets patterns

### Step 3: Analyze from 7 perspectives

MUST evaluate ALL 7 — do not skip any.

**1. Vault completeness**
- All 4 sections filled (not just frontmatter)?
- knowledge.md reflects actual architecture (not outdated)?
- gameplan.md reflects actual progress (phases done match code)?
- conventions.md matches real code patterns?
- Unrecorded ADRs, bugs, or debt visible in code?

**2. Architecture**
- Dependency direction correct? (inner layers don't import outer)
- Single Responsibility: files/modules do one thing?
- God objects: any file/class doing too much?
- Layer separation clean? (no domain logic in controllers, no infra in domain)
- Circular dependencies?

**3. Test coverage**
- All public modules have tests?
- Tests cover: happy path, edge cases, error paths?
- Test quality: meaningful assertions, not just "doesn't throw"?
- Test isolation: no shared state?
- Integration tests exist for critical paths?

**4. Security**
- OWASP Top 10 patterns in code?
- Hardcoded secrets, API keys, passwords?
- Input validation at system boundaries?
- Auth/AuthZ where needed?
- Dependencies: known vulnerabilities? (`npm audit` or equivalent)

**5. Tech debt**
- Recorded debt in `.dev-vault/debt/` — still relevant?
- Unrecorded debt visible in code? (TODO, FIXME, HACK, workarounds)
- Files over 300 lines?
- Functions over 30 lines?
- Dead code, unused imports?

**6. Production readiness**
- Error handling: all external calls have error paths + timeouts?
- Logging: structured logging, no console.log?
- Config: no hardcoded values that should be env/config?
- Graceful shutdown?
- Idempotent operations where needed?

**7. Convention compliance**
- Code matches `.dev-vault/conventions.md`?
- Naming consistent? (check 10+ files)
- File structure matches conventions?
- Git commit style consistent?
- Test patterns consistent?

### Step 4: Score and report

## Output format

MUST use this exact format:

```
══════════════════════════════════
      PROJECT REVIEW: <name>
══════════════════════════════════

Branch: <branch>
Date: <today>
Files scanned: <N>
Tests: <N passed> / <N total>
Build: pass / fail

── SCORES ──

| Perspective          | Score | Issues |
|---------------------|-------|--------|
| Vault completeness  | A/B/C/D/F | <N> |
| Architecture        | A/B/C/D/F | <N> |
| Test coverage       | A/B/C/D/F | <N> |
| Security            | A/B/C/D/F | <N> |
| Tech debt           | A/B/C/D/F | <N> |
| Production readiness| A/B/C/D/F | <N> |
| Convention compliance| A/B/C/D/F | <N> |

Overall: <weighted average> / A

── CRITICAL (must fix) ──

- [SEVERITY] [perspective] <file:line> — <issue>
  Fix: <concrete suggestion>

── HIGH (should fix) ──

- [SEVERITY] [perspective] <file:line> — <issue>
  Fix: <suggestion>

── MEDIUM (consider) ──

- [perspective] <issue summary>

── VAULT GAPS ──

- <what's missing or outdated in vault>

── TECH DEBT INVENTORY ──

Recorded: <N> items in .dev-vault/debt/
Unrecorded: <N> items found in code
- <file:line> — <debt description>

── RECOMMENDATIONS ──

1. <highest priority action>
2. <second priority>
3. <third priority>

── GAMEPLAN vs REALITY ──

| Phase | Gameplan status | Actual status | Match |
|-------|----------------|---------------|-------|
| Phase 1 | done | <code evidence> | yes/no |
| Phase 2 | done | <code evidence> | yes/no |
| ... | ... | ... | ... |

══════════════════════════════════
```

## Scoring criteria

| Score | Meaning |
|-------|---------|
| **A** | Excellent — no issues or only style nits |
| **B** | Good — minor issues, no blockers |
| **C** | Acceptable — some issues need attention |
| **D** | Poor — significant issues, blocks production readiness |
| **F** | Failing — critical issues, not safe to ship |

## Rules

- **Read-only** — NEVER modify any file. VIOLATION = ABORT.
- **All 7 perspectives REQUIRED** — do not skip any. Each MUST produce a score.
- **Evidence-based** — every finding MUST reference a specific file:line. No vague claims.
- **MUST scan minimum 15 files** — representative sample across all modules
- **MUST run tests and build** — report actual results, not assumptions
- **Compare vault with code** — vault says X, code does Y → flag discrepancy
- **Recorded debt review** — check if existing debt records are still relevant or resolved
- **No "best-effort"** — if you can't verify something, say "NOT VERIFIED" with reason

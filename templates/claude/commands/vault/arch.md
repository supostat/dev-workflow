# /vault:arch — Architecture analysis and decision support

Read-only analysis of an architecture question. Researches codebase and vault, proposes 2-3 solutions with trade-offs, recommends one. Does NOT write code.

## Arguments

`/vault:arch "<question>"` — architecture question or decision to analyze.

Examples:
- `/vault:arch "как организовать модуль авторизации?"`
- `/vault:arch "стоит ли разделить этот сервис на два?"`
- `/vault:arch "выбор между REST и gRPC"`
- `/vault:arch "как обрабатывать ошибки в pipeline?"`

## Permissions (VIOLATION = ABORT)

- Read files: YES
- Write/Edit files: FORBIDDEN — analysis only, no code changes
- Bash: FORBIDDEN
- Vault writes: FORBIDDEN — user decides whether to create ADR after analysis

## Procedure

### Step 1: Load context

MUST read:
- `.dev-vault/stack.md` — what technologies are available
- `.dev-vault/conventions.md` — what patterns are established
- `.dev-vault/knowledge.md` — existing architecture, gotchas
- `.dev-vault/gameplan.md` — current phase, priorities

### Step 2: Research codebase

Use Agent (Explore subagent) to:
1. Find code related to the question (Glob/Grep)
2. Read relevant files (max 15 files)
3. Map current architecture around the question area
4. Identify existing patterns that apply
5. Check `.dev-vault/architecture/` for related ADR records

### Step 3: Analyze from 3 perspectives

MUST evaluate from ALL 3:

**Maintainability** — how easy to understand, modify, test?
- Module boundaries clear?
- Dependencies explicit?
- Testable in isolation?

**Security** — attack surface, trust boundaries?
- Where does user input enter?
- What needs authentication/authorization?
- Data protection implications?

**Pragmatism** — effort vs value, simplicity, timeline?
- How much work for each option?
- Fits current phase from gameplan?
- Over-engineering risk?

Note conflicts between perspectives explicitly.

### Step 4: Propose solutions

MUST propose **2-3 solutions** (not 1, not 5+). Each MUST include:

1. **Summary** — 1-2 sentences
2. **How it works** — concrete description with file paths / module names
3. **Pros** — specific, not generic ("reduces coupling between X and Y")
4. **Cons** — specific, honest ("adds N files, complexity in Z")
5. **Fits conventions?** — does it match `.dev-vault/conventions.md`?
6. **Effort** — small / medium / large
7. **Risk** — what could go wrong

### Step 5: Recommend

Pick ONE solution. MUST justify with:
- Why this one over the others
- Which perspective it optimizes for and why
- What trade-offs are accepted

## Output format

MUST use this exact format:

```
══════════════════════════════════
    ARCH: <question short form>
══════════════════════════════════

Context:
  Project: <name> | Branch: <branch> | Phase: <current from gameplan>
  Related files: <N> analyzed
  Existing patterns: <relevant conventions/patterns found>
  Related ADRs: <list or "none">

── Option A: <name> ──

<summary>

How: <concrete description>
Pros:
  + <specific pro>
  + <specific pro>
Cons:
  - <specific con>
  - <specific con>
Conventions: matches / deviates (<what>)
Effort: small / medium / large
Risk: <what could go wrong>

── Option B: <name> ──

<same structure>

── Option C: <name> (if applicable) ──

<same structure>

── Perspective conflicts ──

<if perspectives disagree — describe the conflict and how recommendation resolves it>

── RECOMMENDATION ──

Option <A/B/C>: <name>

Justification:
  <why this one>
  <which perspective it optimizes for>
  <what trade-offs accepted>

Next steps:
  1. <concrete action>
  2. <concrete action>

Record this decision? → /vault:adr

══════════════════════════════════
```

## Rules

- **Read-only** — NEVER modify any file. VIOLATION = ABORT.
- **MUST propose 2-3 options** — not 1 ("here's what you should do"), not 5+ (analysis paralysis)
- **Evidence-based** — every claim MUST reference a specific file or vault entry. No "generally speaking".
- **Concrete** — "move auth logic to src/auth/middleware.ts" not "consider separating concerns"
- **Stack-aware** — options MUST be feasible with current stack from stack.md
- **Convention-aware** — flag if option violates conventions.md, justify why it's worth deviating
- **No code** — describe what to do, not how to implement. Implementation is coder's job.
- **Offer ADR** — always end with suggestion to record as ADR if decision is significant

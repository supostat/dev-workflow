# /intake — Classify free-form input and recommend a workflow

Read-only intake step for free-form requests, ideas, files, or copy/paste content. Classifies the request, proposes 2-3 concrete workflow options with trade-offs, and recommends one. Does NOT write code or run any other workflow — the user picks and runs the recommended workflow next.

## Arguments

- `/intake "<request>"` — classify a free-form prompt
- `/intake --file <path>` — classify content from a file (spec, ADR, copy/paste dump)

If both `<request>` and `--file <path>` are provided, the file content takes precedence.

Examples:
- `/intake "хочу добавить dark mode на страницу настроек"`
- `/intake "почему auth flow иногда падает на refresh?"`
- `/intake --file docs/feature-proposal.md`

## When to use

Use `/intake` whenever the user input is **not** a clear, scoped task:

- Vague feature ideas ("улучшить производительность", "сделать получше")
- Open questions ("стоит ли разделить этот сервис?", "что если поменять схему?")
- Copy/paste from chats, specs, tickets, ADRs
- Files dropped without context
- "Просто посмотри на это и скажи что думаешь"

Do **not** use `/intake` for:
- Clearly scoped tasks (use `/workflow:dev "..."` directly)
- Architecture-only questions where you don't intend to implement (use `/vault:arch`)
- Existing tasks already in the vault

## Permissions (VIOLATION = ABORT)

- Read files: YES
- Write/Edit files: FORBIDDEN
- Bash: FORBIDDEN
- Vault writes: FORBIDDEN — the user decides what to do after intake

## Procedure

### Step 1: Load context

MUST read:
- `.dev-vault/stack.md` — what technologies are available
- `.dev-vault/conventions.md` — what patterns are established
- `.dev-vault/knowledge.md` — existing architecture, gotchas
- `.dev-vault/gameplan.md` — current phase, priorities

### Step 2: Read the input

- If `--file <path>` is provided, read the file with the Read tool.
- Otherwise the input is the quoted argument string.

### Step 3: Classify

Identify what kind of request this is:
- Feature implementation
- Bug fix or hotfix
- Refactor or cleanup
- Architecture decision or exploration
- Question or clarification
- Code review request
- Test gap or testing request

### Step 4: Propose 2-3 options

Each option MUST be a real, distinct workflow path — not a variation. For each option include:

1. **Workflow name** — one of the available workflows (`dev`, `hotfix`, `review`, `test`, or a custom one from `.dev-vault/workflows/`)
2. **Best for** — when this option fits
3. **Steps** — brief pipeline summary
4. **Trade-off** — what you gain, what you skip

### Step 5: Recommend

Pick exactly one option. Justify the choice with concrete references to the project vault (stack/conventions/knowledge/gameplan). End with the exact next command to run.

## Output format

MUST use this exact format:

```
══════════════════════════════════
    INTAKE: <short request summary>
══════════════════════════════════

Classification: <1-2 sentences describing what the user is asking for>

── Option A: <workflow name> ──

Best for: <when this fits>
Steps: <brief pipeline>
Trade-off: <gain vs skip>

── Option B: <workflow name> ──

<same structure>

── Option C: <workflow name> (if applicable) ──

<same structure>

── RECOMMENDATION ──

Option <A/B/C>: <workflow name>

Why: <justification grounded in stack, conventions, knowledge, or gameplan>

Next step: /workflow:dev <workflow-name> "<refined task description>"

══════════════════════════════════
```

## Rules

- **Read-only.** Never modify any file. Never run shell commands. Never touch git. VIOLATION = ABORT.
- **MUST propose 2-3 options** — not 1, not 5+. One option means you're hiding alternatives; five means you're indecisive.
- **Concrete workflow names** — only suggest workflows that actually exist (`dev`, `hotfix`, `review`, `test`, or files in `.dev-vault/workflows/`). Do not invent names.
- **Evidence-based** — every recommendation must reference something specific from the project vault.
- **No implementation.** You describe the workflow, you do not run it. The user runs the recommended next command themselves.
- **No code.** If the request needs code, the recommended workflow's coder agent writes it — not you.

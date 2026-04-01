# /vault:from-spec — Fill vault from project specification

Read SPEC.md (or provided file) and fill all vault sections through phased approval.
For new projects where only a specification exists and the codebase is empty or minimal.

## Procedure

### Step 1: Find and read spec

1. If argument provided — read that file
2. Otherwise search: `SPEC.md`, `spec.md`, `docs/SPEC.md`, `.dev-vault/spec.md`
3. If not found:

> No spec file found. Create SPEC.md in the project root with at least:
> - Technology stack (languages, frameworks, databases)
> - Architecture overview
> - Features / phases
>
> Then run `/vault:from-spec` again, or pass a path: `/vault:from-spec docs/my-spec.md`

4. Read the spec file fully

### Step 2: Check vault state

Read all vault files and show current state:

📚 **From spec:** \<filename\> (\<N lines\>)

| Section | Status | Content |
|---------|--------|---------|
| stack.md | ✅ / ○ | N technologies / empty |
| conventions.md | ✅ / ○ | N rules / empty |
| knowledge.md | ✅ / ○ | N entries / empty |
| gameplan.md | ✅ / ○ | N phases / empty |

**Plan:** fill \<N\> empty sections from spec. Already filled sections — append only, no overwrite.

**Start?** (yes / edit / skip)

### Step 3: Fill vault (4 phases)

Wait for user confirmation before each phase.

#### Phase 1: stack.md — Technology stack

Extract from spec: languages, frameworks, databases, ORMs, testing tools, infrastructure, dev tools.

If spec is vague (e.g., "modern stack"), propose concrete choices with rationale.

Show before writing:

📚 **Phase 1/4 — stack.md**

```markdown
## Languages
- <language> — <version if mentioned, purpose>

## Frameworks
- <framework> — <purpose>

## Database
- <database> — <purpose>

## Testing
- <tool> — <purpose>

## Infrastructure
- <tool> — <purpose>

## Dev Tools
- <tool> — <purpose>
```

**Only include sections that have content from the spec.**

If stack.md already has content — show diff: what will be added, what already exists.

**Apply?** (yes / edit / skip)

If yes — write to `.dev-vault/stack.md`, preserving existing content.

#### Phase 2: conventions.md — Code conventions

Extract or derive from spec: file structure, naming conventions, code style, patterns, git workflow, testing approach.

If spec does not mention conventions explicitly — derive from the chosen stack:
- TypeScript project → suggest standard TS conventions
- Rust project → suggest standard Rust conventions
- etc.

Reference stack.md from Phase 1 for consistency.

Show before writing:

📚 **Phase 2/4 — conventions.md**

```markdown
## File Structure
- <directory> — <purpose>

## Naming
- Functions: <convention>
- Types/Classes: <convention>
- Files: <convention>
- Database: <convention if applicable>

## Code Style
- <rule>

## Patterns
- <pattern>: <where/when>

## Git
- Branches: <convention>
- Commits: <convention>

## Testing
- <approach>
```

**Apply?** (yes / edit / skip)

#### Phase 3: knowledge.md — Architecture, Data Model, API, Security

This is the most substantial phase. Extract from spec and analyze from multiple perspectives.

**3a: Architecture**

Extract: components, their relationships, data flow, deployment model.

Analyze from 3 perspectives:
- **Maintainability** — separation of concerns, modularity, testability
- **Security** — attack surface, trust boundaries, auth/authz model
- **Pragmatism** — complexity vs value, MVP scope, what to defer

If perspectives conflict — note the conflict and recommend a resolution.

**3b: Data Model (if applicable)**

Extract: entities, relationships, constraints, indexes.

**3c: API (if applicable)**

Extract: endpoints, methods, auth requirements, request/response shapes.

**3d: Security**

Extract: auth mechanism, data protection, input validation, secrets management.

Show before writing:

📚 **Phase 3/4 — knowledge.md**

```markdown
## Architecture
- <component> -> <component>: <relationship>
- Deployment: <model>

## Data Model
- <entity>: <key fields, relationships>

## API
- <method> <path> — <purpose> [auth: <type>]

## Security
- Auth: <mechanism>
- Data: <protection approach>
- Validation: <approach>

## Gotchas
- <non-obvious constraint or decision from spec>
```

**Only include sections that have content from the spec.**

If knowledge.md already has content — append new sections, do not overwrite existing.

**Apply?** (yes / edit / skip)

#### Phase 4: gameplan.md — Phases and tasks

Break the spec into implementation phases. Each phase should be:
- Independently deployable (or at least testable)
- 1-3 days of work
- Ordered by dependencies (foundation first)

Show before writing:

📚 **Phase 4/4 — gameplan.md**

```markdown
## Current Phase
Phase 1: <name>

## Phases

### Phase 1: <name> — <goal>
- [ ] <task>
- [ ] <task>
**Done when:** <completion criteria>

### Phase 2: <name> — <goal>
- [ ] <task>
- [ ] <task>
**Done when:** <completion criteria>

### Phase N: Hardening
- [ ] Test coverage
- [ ] Security audit
- [ ] Performance
- [ ] Documentation
**Done when:** <completion criteria>

## Backlog
- <deferred items from spec>
```

**Apply?** (yes / edit / skip)

After approval, offer to create tasks:

> Create tasks from Phase 1? (yes / no)

If yes — create task for each item in Phase 1 via `dev-workflow task create "<title>"`.

### Step 4: Summary

✅ **vault:from-spec complete**

| Phase | Section | Items | Status |
|-------|---------|-------|--------|
| 1 | stack.md | +N technologies | ✅ applied / ○ skipped |
| 2 | conventions.md | +N rules | ✅ applied / ○ skipped |
| 3 | knowledge.md | +N entries | ✅ applied / ○ skipped |
| 4 | gameplan.md | +N phases, M tasks | ✅ applied / ○ skipped |

**Next steps:**
- Review vault: `dev-workflow status`
- Start Phase 1: `dev-workflow task list` then `dev-workflow task start <id>`
- Or run full workflow: `dev-workflow run dev "Phase 1 task"`

## Rules

- **Gate criteria:** each phase requires explicit user approval before writing
- **Preserve existing content** — never overwrite filled sections, only append
- **Be specific** — "TypeScript 5.x with strict mode" not "typed language"
- **Derive when implicit** — if spec says "REST API" but not "Express", propose based on stack
- **Skip empty phases** — if spec has no data model, skip 3b entirely
- **No secrets** — never include API keys, passwords, or credentials
- **Reference spec** — cite which part of the spec each item comes from
- **Multi-perspective on architecture only** — other phases use single-pass analysis
- **Gameplan phases are coarse** — detailed task breakdown happens in `/task` and `/workflow`

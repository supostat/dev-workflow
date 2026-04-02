# Step 9b: Vault updates (after commit)

Orchestrator writes directly to vault after successful commit.
Use **Edit tool** to append — **never overwrite** existing vault files.

## 1. Daily log

Append to `.dev-vault/daily/<today>.md`:

```
> workflow:dev completed at HH:MM — "<task summary>"
> Commit: <hash> | Files: <N> changed, <N> created | Tests: <N>
> [If review findings:] Gotchas recorded in knowledge.md
```

If file exists — read first, then Edit to append after `---` separator.
If file does not exist — create with Write tool.

## 2. Phase status (phase mode only)

Update frontmatter in phase file:

```yaml
status: done  # was: pending
```

## 3. Task status (if task linked)

Update task file:

```yaml
status: done  # was: in-progress
```

## 4. Gameplan progress (phase mode only)

Check off completed items in `.dev-vault/gameplan.md`:

```markdown
- [x] <completed task>  # was: - [ ]
```

## Phase mode: vault refresh between subtasks

After each subtask complete:
- Re-read `.dev-vault/conventions.md` (may have new patterns from review)
- Re-read `.dev-vault/knowledge.md` (may have new gotchas from review)
- Pass updated vault content to next subtask's CODER and REVIEW agents

## 5. Auto-create vault records

Create records automatically using MCP tool `vault_record(type, title, content)`.
Data is already in pipeline context — no need to ask the user.

### ADR (architecture decisions)

Create if PLAN contained:
- DEVIATION from conventions (with justification)
- Architecture section with alternatives considered
- Dependency direction change or new layer introduced

```
vault_record(type: "adr", title: "<decision>", content: "Context: <from PLAN>\nDecision: <what was chosen>\nAlternatives: <from PLAN Architecture section>\nConsequences: <trade-offs>")
```

### Bug (fixed issues)

Create if REVIEW found CRITICAL or HIGH and CODER fixed it:
- Root cause was non-obvious
- Fix required understanding of system internals

```
vault_record(type: "bug", title: "<issue summary>", content: "Symptoms: <from REVIEW issue>\nRoot cause: <from CODE_FIX>\nFix: <what was changed>\nPrevention: <how to avoid>")
```

### Debt (deferred work)

Create if CODER skipped MEDIUM review issues:
- Issue acknowledged but not fixed
- Reason documented in CODE_FIX Skipped section

```
vault_record(type: "debt", title: "<deferred issue>", content: "Problem: <from REVIEW issue>\nWhy deferred: <from CODE_FIX Skipped reason>\nProposal: <suggested fix>\nRisk if ignored: <impact>")
```

### Rules

- Only create if data exists in pipeline context (PLAN, REVIEW, CODE_FIX blocks)
- Do NOT create for: LOW/style issues, clean pipelines with no findings, trivial bugs
- One record per significant finding, not one per REVIEW issue
- Display created records in summary:

```
Vault records created:
  ADR: .dev-vault/architecture/<date>-<slug>.md
  Bug: .dev-vault/bugs/<date>-<slug>.md
  Debt: .dev-vault/debt/<date>-<slug>.md
```

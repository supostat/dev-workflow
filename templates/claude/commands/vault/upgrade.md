# /vault:upgrade — Safely upgrade dev-workflow against the installed package

Compare your project's installed dev-workflow files against the templates
bundled with the resolved `@engramm/dev-workflow` install (resolution oracle:
`dev-workflow templates-root`, see Step 0). Works across all install modes —
local dependency, `npm link` global, `pnpm link --global`, or dogfooding.
Per-category two-phase plan/apply with mandatory timestamped backup. Never
auto-overwrites your customizations in `.dev-vault/`.

## Permissions

- Read: yes (templates source + downstream files)
- Edit/Write: yes — downstream `.claude/` and root config files only. Forbidden in `.dev-vault/`
- Bash: yes — limited to `dev-workflow templates-root`, `npx --no-install dev-workflow templates-root`, `pnpm exec dev-workflow templates-root`, `npm root`, `test -d`, `test -f`, `mkdir -p`, `cp -P -p`, `date -u`, `cmp -s`, `ls`
- MCP vault writes: no — this slash never calls `vault_record` / `vault_knowledge` / `vault_pattern`
- VIOLATION = ABORT: any write to `.dev-vault/`, to a file outside the approved category list, or before backup confirmation

## Arguments

```
/vault:upgrade [--dry-run]
```

- (no flag) — full interactive upgrade with backup and approvals
- `--dry-run` — plan only; no backup, no write; preview the same per-category report you'd see in a real run

## Procedure

### Step 0: Resolve TEMPLATES source

The CLI itself is the canonical oracle: `dev-workflow templates-root` prints the absolute path to its own bundled `templates/` dir via `import.meta.url`, independent of how the package is installed (npm link, pnpm link --global, local dependency, dogfooding). Try the CLI by 4 invocation strategies; legacy fallback kicks in only for old CLI builds predating this command.

Each attempt is independent — proceed to next on non-zero exit. Trim whitespace from stdout on success.

1. **Direct CLI** — `dev-workflow templates-root`. Works when bin is on `$PATH` (npm link / pnpm link --global / global install).
2. **npx local** — `npx --no-install dev-workflow templates-root`. Works for local npm install (resolves `node_modules/.bin/`).
3. **pnpm exec** — `pnpm exec dev-workflow templates-root`. Works for local pnpm install.
4. **Legacy fallback** (CLI predates `templates-root` command, e.g. v0.1.7 and earlier):
   - Run `npm root` (Bash). Let `ROOT` be its output.
   - Try in order:
     - `$ROOT/@engramm/dev-workflow/templates/`
     - `$ROOT/dev-workflow/templates/` (unscoped)
     - If `cwd/package.json` has `"name": "@engramm/dev-workflow"` → `./templates/` (dogfooding)

If all 4 attempts fail → abort: `dev-workflow templates not resolvable; ensure @engramm/dev-workflow is installed (npm install / pnpm install / npm link / pnpm link --global) and \`dev-workflow\` is on PATH or local node_modules`.

Save the resolved path as `TEMPLATES` and validate (each check on its own line — abort on first failure):

1. `test -d "$TEMPLATES"` (Bash) — must be a directory (rejects file or broken symlink)
2. `test -d "$TEMPLATES/claude/commands"` (Bash) — structural sanity check
3. `test -f "$TEMPLATES/../package.json"` (Bash) — sibling `package.json` must exist
4. Use the **Read tool** (not shell) to read `$TEMPLATES/../package.json`. Parse the JSON in-agent and assert `name === "@engramm/dev-workflow"`. If mismatch or JSON parse fails, abort: `templates source corrupted: package.json invalid or name mismatch at <path>`

Record the `version` field from the parsed `package.json` for the final summary.

### Step 1: Pre-flight

1. Verify `cwd` has at least one of: `.claude/`, `.dev-vault/`. Otherwise abort: `Not a dev-workflow downstream project. Run \`dev-workflow init\` first`.
2. **Concurrency guard.** Check for `.dev-workflow-upgrade-backup/.lock` file. If present and modified within the last 30 minutes, abort: `Another upgrade in progress (lock at <path>, mtime <date>); wait or remove the lock file manually if you're sure no other run is active`. Otherwise create the lock file with current timestamp. Always remove it on slash exit (success, abort, or error).
3. Generate timestamp: `BACKUP_TS=$(date -u +%Y-%m-%dT%H-%M-%S-%3NZ)` (millisecond precision — eliminates same-millisecond collisions).
4. Backup root: `BACKUP_ROOT=.dev-workflow-upgrade-backup/$BACKUP_TS/`. **Do NOT create the directory yet** — only create on first actual file backup in Step 5. On `--dry-run`, never create.
5. Print plan banner: `Iterating <N> categories. Backup root: $BACKUP_ROOT (skipped on --dry-run).`

### Step 2: Classify per file (template ↔ downstream pair)

**Pre-classification safety check.** For every downstream file before reading content:

1. Reject any path containing `..` or absolute path components after computing relative-path against project root. Abort that file pair only with `path traversal in downstream: <path>; skipping`.
2. Detect symlinks via `ls -la <path>` (look for `l` in mode column) before invoking Read. If symlink, do NOT read content. Mark as `user-modified`/advisory with note `symlink → <target>` and skip from any auto-upgrade proposal.

For each file pair, classify with this taxonomy:

| Status | Detection rule | Default action |
|--------|----------------|----------------|
| identical | `normalize(template) === normalize(downstream)` | skip silently |
| missing-downstream | template exists, downstream missing | propose add |
| missing-template | downstream exists, template doesn't | advisory only (suggest manual review) |
| safe-upgrade | downstream frontmatter has `generated: true` AND content differs after normalize | propose overwrite |
| user-modified | no `generated: true` AND content differs, OR path is in user-customization slot (`.dev-vault/agents/`, `.dev-vault/workflows/`, `.dev-vault/workflow-steps/`) | advisory — never auto-overwrite |
| conflict | template differs AND downstream looks hand-edited (lacks `generated: true` AND structural drift from any known prior template) | manual decision required |

`normalize(text)` = `text.replace(/\r\n/g, "\n").trimEnd()` — matches `src/hooks/workflow-shim-sync.ts:117-118` (`shimContentEquals`).

Frontmatter parsing: read first `---` block, parse YAML, check `generated: true`.

### Step 3: Categories (in order)

Process one category at a time. Within a category, process sub-groups one at a time. Wait for user approval before moving to the next.

#### Category A — `.claude/commands/` ↔ `$TEMPLATES/claude/commands/`

Sub-grouped to avoid context bloat:

- **A1** `git/` (4 files: changelog, merge, new-branch, pr-review)
- **A2** `vault/` (12 files: adr, analyze, arch, bug, debt, deps, from-spec, pattern, project-review, search, security-scan, test-gaps). **Never upgrade `upgrade.md` itself** — overwriting the slash mid-execution would break the currently-running command. Always exclude.
- **A3** `session/` (3 files: handover, resume, review)
- **A4** `workflow/` root: `_dispatch.md` (hand-maintained, full diff) + builtin shims (`dev.md`, `hotfix.md`, `intake.md`, `review.md`, `test.md`, `create.md`). **Skip any shim with frontmatter `generated: true`** — those are auto-generated by the session-start hook from `.dev-vault/workflows/*.yaml` and will refresh on next session restart. Report count in summary.
- **A5** `workflow/steps/` (10-11 files: coder, commit, plan-review, plan, preflight, principles, read, review, test, vault-updates, verify)
- **A6** Root commands (`intake.md`, `task.md`, `workflow.md`)

Per sub-group: classify → display category summary → numbered approval → backup + write → next sub-group.

#### Category B — `.claude/agents/` ↔ `$TEMPLATES/claude/agents/`

2 files: `researcher.md`, `writer.md`. Single approval prompt (small).

#### Category C — `.claude/skills/` ↔ `$TEMPLATES/claude/skills/`

`obsidian-markdown` plugin (`SKILL.md` + reference files). Treat as one unit — diff and approve as a group.

#### Category D — `.claude/settings.json` (MERGE, never overwrite)

1. Parse both JSON files. Abort category D only if downstream is invalid JSON: report `invalid JSON in settings.json; skipping category D, fix manually`. Continue to other categories.
2. **Reserved key guard.** Reject merge if either side contains top-level keys `__proto__`, `constructor`, or `prototype` (prototype-pollution vectors). Abort category D only: `settings.json contains reserved key <key>; skipping merge — manual review required`.
3. Compute key-by-key delta:
   - **New top-level keys** in template → propose addition
   - **Hooks array changes** — dedup by stringified command. New template hooks proposed; user-only hooks preserved
   - **Permissions array changes** — preserve user-added entries; surface template additions as proposals
   - **Conflicts** (e.g. template has hook command X, downstream has similar-but-different X′) — display as numbered sub-prompts:
     ```
     Settings conflicts:
     1. Hook "PostToolUse" — template has Y, you have X
        → 1a. accept template (replaces yours)
        → 1b. keep yours
        → 1c. add both
     2. Permission "bash:rm" — only in your version
        → 2a. preserve  2b. remove
     ```
4. **Never silent-merge.** If a key changes meaning ambiguously, surface as conflict.
5. Backup `settings.json` whole-file before write. Apply delta as a single Write of the merged result.

Replicate semantics from `src/cli/init.ts:30-74` (`mergeSettingsJson`).

#### Category E — `CLAUDE.md` + `.gitignore` (append-only)

- **CLAUDE.md**: ensure the engram protocol section (template content from `templates/records/engram-protocol.md`) is present. If missing, propose append. If present and template version differs, ask: `1. replace section  2. keep yours  3. show diff`.
- **`.gitignore`**: ensure required entries are present (per template). Append missing. Never remove user entries.

Append-only via Edit tool, never Write.

#### Category F — User customization advisory (READ-ONLY)

For each file in:
- `.dev-vault/agents/*.md`
- `.dev-vault/workflows/*.yaml`
- `.dev-vault/workflow-steps/*.md`

Display: `<filename> — overrides builtin <name> (templates/<path>); review compatibility with current template version <X>`. Never write. No backup. No approval. Pure advisory.

### Step 4: Per-category approval (numbered options)

After classification, display:

```
📋 Category <name> — <N> files
- ✅ identical: <count> (skipped)
- 🟢 safe-upgrade: <count>
- ➕ missing-downstream: <count>
- 🟡 user-modified: <count> (advisory)
- 🔴 conflict: <count>
- ➖ missing-template: <count> (advisory)

Files (non-identical):
  1. <path> — <status> — <one-line diff hint>
  2. <path> — <status> — <one-line diff hint>
  ...

Choose:
  1. apply all proposed (safe-upgrade + missing-downstream)
  2. apply selected (you'll specify comma-separated indices)
  3. show full diffs (re-display with content)
  4. skip category
```

Wait for user response. On `2`, ask: `indices? (e.g. 1,3,5)`.

### Step 5: Apply (skipped on `--dry-run`)

For each file the user approved:

1. **Pre-write fence.** Reject any target path that:
   - Starts with `.dev-vault/` or contains `/.dev-vault/` — abort: `VIOLATION: refused to write to .dev-vault/<path>` (Category F is read-only by design)
   - Contains `..` after path normalization, OR escapes the project root via `realpath` comparison — abort that file pair only with `path traversal: <path>; skipping`
   - Is outside the current category's allowlist (e.g. Category A only writes inside `.claude/commands/`) — abort: `outside category scope: <path>`
2. Create backup root if not yet created: `mkdir -p "$BACKUP_ROOT"` (first write only).
3. Backup parent dir: `mkdir -p "$BACKUP_ROOT/<dir-of-relative-path>"`. **All shell variables MUST be double-quoted to prevent word-splitting and metacharacter expansion.**
4. If downstream file exists: `cp -P -p "<downstream>" "$BACKUP_ROOT/<relative-path>"` (preserve symlinks, preserve mtime).
5. Write/Edit the new content from template via the Write/Edit tool (not shell `cp` from template — use the agent's tools to apply the new content).
6. Verify post-write match: read written file, normalize, compare to template normalized. If mismatch, abort the rest of this category and report: `Category <X> aborted at file <i>/<n>: post-write verification failed; backup at $BACKUP_ROOT`.

**Shell-quoting rule:** every variable expansion in `mkdir`/`cp`/`rm`/`ls` commands MUST use double quotes (e.g. `"$BACKUP_ROOT/$path"`, not `$BACKUP_ROOT/$path`). Filenames may contain spaces or shell metacharacters; unquoted expansions are a command-injection vector.

### Step 6: Final summary

Display as plain markdown (NOT in a code fence):

```
✅ Upgrade complete (template version: <X>)

- Categories processed: <N>
- Files updated: <N>
- Files added: <N>
- Files skipped (identical): <N>
- Auto-generated shims pending: <N> (will refresh on next Claude Code session restart)
- Files left for manual review: <N> (user-modified, conflict, missing-template)
- Backup: .dev-workflow-upgrade-backup/<TS>/ (<size> on disk)

Rollback (whole upgrade):
  rm -rf .claude && cp -R .dev-workflow-upgrade-backup/<TS>/.claude .
  (per-file rollback: see backup directory listing)
```

If `--dry-run`:

```
📋 Dry-run complete — no changes written

(same content but with "would update / would add" verbs; backup section reads "would create at .dev-workflow-upgrade-backup/<TS>/")
```

## Error handling

| Failure | Action |
|---------|--------|
| `npm root` doesn't find `@engramm/dev-workflow` and not in dogfooding mode | abort: `dev-workflow not installed; run \`npm install @engramm/dev-workflow\`` |
| `cwd` is not a downstream project (no `.claude/` and no `.dev-vault/`) | abort: `Not a dev-workflow project. Run \`dev-workflow init\` first` |
| `mkdir -p $BACKUP_ROOT` fails (permission / disk full) | abort BEFORE any write: `Cannot create backup at <path>: <error>; refusing to proceed` |
| `settings.json` JSON.parse fails on downstream | abort category D only, continue others: `invalid JSON in settings.json; skipping merge — fix manually` |
| Write fails mid-category | stop category immediately, do NOT continue. Summary: `Category <X> aborted at file <i>/<n>; backup at $BACKUP_ROOT; <files-applied> were updated, rest unchanged` |
| Post-write verification fails (file content didn't match template after write) | same as above — stop category, report mismatch with file path |
| Symlinks in `.claude/` | use `cp -P` (no-deref) for backup; classification reads target via Read tool only |

## Rules

- **Mandatory backup before any write** when not `--dry-run`. No exceptions.
- **Numbered approvals only** — never yes/no for choice questions (CLAUDE.md project rule).
- **Per-category confirmation** — never auto-apply across categories. User pauses between each.
- **Never write to `.dev-vault/`** — that's user content. Category F is read-only by design.
- **Never write outside the approved category** in a given step (e.g. don't touch `package.json`, `tsconfig.json`, source files).
- **Auto-generated shims** (`.claude/commands/workflow/<name>.md` with frontmatter `generated: true`) are owned by the session-start hook (`src/hooks/workflow-shim-sync.ts`). Skip them in this slash; report count in summary so the user knows they refresh on next session restart.
- **Output language separation**: this slash file (template content) is in English — matches existing `/vault:*` template style. The orchestrator agent MUST translate runtime user-facing output to Russian: every numbered approval prompt, every category summary banner, every error message, and the final summary. Quoted shell command lines and file paths stay verbatim. Per project CLAUDE.md "ТОЛЬКО РУССКИЙ".
- **Verification after write**: every file written must pass a post-write read+normalize check. Mismatch = abort category, leave backup intact.

## When to use

- After `npm update @engramm/dev-workflow` to refresh shipped templates
- When `/session:resume` or another command warns that templates are behind the installed package
- When introducing a new dev-workflow release into an existing project that already has customizations

## When NOT to use

- For first-time setup → use `dev-workflow init` instead
- For overwriting your `.dev-vault/` content → never; that's your project's data, not a template
- In CI / non-interactive environments → use `dev-workflow update` (force-mode CLI) which bypasses approval
- For partial category runs → not supported in v1 (all categories iterate in sequence; skip via option 4 per category)

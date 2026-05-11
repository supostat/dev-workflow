# Contributing to dev-workflow

Thanks for considering a contribution. This is a single-maintainer
project, so response times are best-effort. Read the relevant section
below before opening anything.

## Project layout

```
src/                  TypeScript sources (Node 20+, ESM)
  cli/                CLI commands (one file per command)
  lib/                Shared utilities (engram client, parsers, etc.)
  mcp/                MCP server + tool handlers (one file per domain)
  workflow/           Pipeline engine, state, loader, validator
  hooks/              SessionStart/SessionEnd/TaskCompleted hooks
  agents/             Agent registry + loader + context builder
  tasks/              Task manager + tracker + phase parser
tests/                Vitest suites — mirror src/ paths
templates/            Bundled assets shipped with the npm package
  workflows/          Builtin dev / hotfix / review / spike / etc.
  claude/             .claude/commands + agents shipped to downstream
  project/            CLAUDE.md / SPEC.md / settings.json templates
  agents/             Builtin agents (reader / coder / reviewer / …)
website/              Fumadocs site (deployed to dev-workflow website)
examples/             Copy-paste workflow YAMLs for users
.dev-vault/           This project's own vault (gitignored)
.github/              CI workflows + issue/PR templates
docs/                 SPEC.md + ADRs that ship with the package
scripts/              Maintenance scripts (sync-from-templates, etc.)
```

## Development setup

```bash
git clone git@github.com:supostat/dev-workflow.git
cd dev-workflow
pnpm install
pnpm build
pnpm test            # run unit + integration tests (currently ~840)
pnpm test:coverage   # with coverage report (thresholds enforced)
pnpm lint            # tsc --noEmit
```

Node 20+ required (ESM, type: "module"). pnpm is the package manager;
`npm install` will work but the lockfile is pnpm's.

## Workflow

For non-trivial changes, use the project's own workflow engine:

```bash
# In Claude Code:
/workflow:dev "your task description"
```

This runs the full 11-step pipeline: preflight → read → plan →
plan-review → plan-fix → code → review → test → verify → commit →
vault-updates. The review step runs 3 parallel reviewers
(security/quality/coverage).

For documentation-only or scratch work, see
[`examples/`](./examples/) for lighter workflows.

## Coding conventions

The project follows the conventions documented in
[`.dev-vault/conventions.md`](.dev-vault/conventions.md) (gitignored
in your local clone — see `templates/project/CLAUDE.md` for a public
copy). Highlights:

- **Naming**: kebab-case for files (`stack-detect.ts`), camelCase for
  functions, PascalCase for types/classes, UPPER_SNAKE_CASE for Set
  constants.
- **ESM imports** with `.js` extensions: `from "./lib/engram.js"`.
- **No barrel re-exports** except `src/index.ts`.
- **One class/module per file.** No `helpers/` or `utils/` catch-alls.
- **Tests follow the code** — adding a function in `src/lib/foo.ts`
  means adding (or extending) `tests/foo.test.ts`.
- **Coverage thresholds** are enforced at 80/82/78/71 (statements /
  functions / lines / branches). New code should not lower them.
- **Real-fixture pattern over `vi.mock`** — only `src/lib/engram.js`
  may be mocked (engram socket isolation). Everything else uses
  `mkdtempSync` + real fs + ENV stubs.

## Commit messages

Conventional commits — English subject, descriptive body:

```
feat(scope): one-line subject

Optional body explaining the why. Include rationale, alternatives
considered if non-obvious, and references to debts/ADRs.

Tests: 830 → 838 (+8). tsc clean.
```

Types we use: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`,
`style`. Use `!` after the type for breaking changes (`fix!: ...`).

Subject line: ≤72 chars. Body: wrap at ~72.

No `Co-Authored-By` lines — see project-level
[CLAUDE.md](templates/project/claude-md). Commit messages are in
English even if conversation context is Russian — git history is
uniform.

## Pull requests

1. **Branch from `main`**. Name: `feat/short-description` or
   `fix/short-description`.
2. **Tests pass**: `pnpm test` AND `pnpm test:coverage` (thresholds).
3. **tsc clean**: `pnpm lint` (which runs `tsc --noEmit`).
4. **CHANGELOG entry**: add a line under the appropriate section of
   the unreleased version (or open a new section if your change is
   the first since the last release).
5. **PR description**: use the template — what / why / test plan.
6. **One PR = one logical change.** Refactors get their own PR
   separate from feature additions.

## Reporting bugs

Open a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) — fill in:

- Version (`npm list @engramm/dev-workflow`)
- Node version (`node --version`)
- Minimum repro
- Expected vs actual

For security issues, follow [SECURITY.md](SECURITY.md) — **do not
file public issues for vulnerabilities.**

## Feature requests

Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.md).
Describe the user-facing problem before the proposed solution.
Features that match the project's scope (Claude Code workflow
engine + vault + MCP) are more likely to land than tangential
additions.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). TL;DR: be respectful,
assume good intent, focus on the work.

## License

MIT. By contributing you agree your contributions are MIT-licensed.

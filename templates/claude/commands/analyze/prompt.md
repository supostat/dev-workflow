# /analyze — Deep project analysis and vault population

Analyze the codebase and fill all vault sections with discovered information.
This command uses AI to understand code structure, patterns, and conventions
that static detection (`init --detect`) cannot capture.

## Procedure

### Step 1: Read current vault state

Read all vault files to understand what's already filled:
- `.dev-vault/stack.md`
- `.dev-vault/conventions.md`
- `.dev-vault/knowledge.md`
- `.dev-vault/gameplan.md`

### Step 2: Scan project structure

1. Run `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/target/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.dev-vault/*' | head -100` to get file listing
2. Identify project layout: monorepo, single package, workspace
3. Identify key directories and their purpose

### Step 3: Analyze code patterns

Read 5-10 representative source files (pick diverse areas):
- Entry points (main.rs, index.ts, app.py, main.go)
- Core modules (most imported files)
- Test files (test patterns, assertion style)
- Configuration files

Extract:
- **File Structure**: directory organization pattern, module boundaries
- **Naming**: variable/function/type naming conventions observed in code
- **Code Style**: error handling patterns, logging, dependency injection
- **Patterns**: common abstractions, design patterns used
- **Testing**: test organization, fixture patterns, mocking strategy

### Step 4: Fill vault sections

For each section, use MCP tool `vault_knowledge` to append findings,
or edit files directly. **Preserve existing content** — only add new information.

#### stack.md
- Verify auto-detected stack is accurate
- Add details: specific library versions, why chosen

#### conventions.md — File Structure
Append to `## File Structure`:
```
- <directory> — <purpose>
```

#### conventions.md — Naming
Append to `## Naming`:
```
- Functions: <observed convention> (e.g., snake_case, camelCase)
- Types/Structs: <convention>
- Files: <convention>
- Constants: <convention>
```

#### conventions.md — Code Style
Append to `## Code Style` (beyond what --detect found):
```
- Error handling: <pattern> (e.g., Result<T, E>, try/catch, anyhow)
- Logging: <library and pattern>
- Configuration: <how config is loaded>
```

#### conventions.md — Patterns
Append to `## Patterns`:
```
- <pattern name>: <where and how used>
```

#### knowledge.md — Architecture
Append to `## Architecture`:
```
- <component> → <component>: <relationship>
```

#### knowledge.md — Gotchas
Append to `## Gotchas` if found in code comments, README, or apparent from structure:
```
- <gotcha description>
```

### Step 5: Summary

```
## Analyze Complete

Vault sections updated:
  stack.md:        <verified / N items added>
  conventions.md:  <N items added to M sections>
  knowledge.md:    <N items added>
  gameplan.md:     <unchanged — fill manually>

Key findings:
  - <most important discovery about the project>
  - <second finding>
  - <third finding>
```

## Rules

- **Preserve existing content** — never overwrite, only append
- **Be specific** — "functions use snake_case" not "standard naming"
- **Reference files** — "error handling in cli/src/main.rs uses anyhow"
- **Skip gameplan.md** — roadmap is human-authored, not machine-guessable
- Read max 15 files to keep analysis focused
- If vault section already has good content, skip it
- Never include secrets, API keys, or credentials in vault

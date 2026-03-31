# /vault:deps — Map project dependencies

Analyze project dependency graph and record in vault knowledge.

## Procedure

1. Identify dependency sources:
   - `package.json` (dependencies, devDependencies)
   - `Cargo.toml` (dependencies, dev-dependencies)
   - `go.mod` (require block)
   - `requirements.txt` / `pyproject.toml`

2. Analyze internal module dependencies:
   - Scan import/use statements across source files
   - Build a module dependency graph
   - Identify circular dependencies
   - Find most-imported modules (core modules)

3. Identify key external dependencies:
   - Which libraries are load-bearing (used everywhere)
   - Which are isolated (used in one module)
   - Version constraints and update status

4. Record in vault:
   - Use MCP tool `vault_knowledge` section "Architecture" to append:

```
### Dependency Graph

Core modules (most imported):
- <module> — imported by N files

External dependencies:
- <library> — used for <purpose>, <where>

Internal module relationships:
- <module A> → <module B>: <relationship>

Circular dependencies: <none / list>
```

## Rules

- Read-only — never modify source code
- Focus on architecture-relevant dependencies, not every import
- Max 20 files sampled for import analysis

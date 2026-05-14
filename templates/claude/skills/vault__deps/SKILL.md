---
name: vault:deps
description: Map the project's dependency graph (core modules, external libs, relationships, cycles) and append to knowledge.md Architecture section. Read-only — scans imports across up to 20 source files without modifying any code.
allowed-tools: [Bash, Read, Grep, mcp__dev-workflow__vault_knowledge]
invocation: user
---

# /vault:deps — Map project dependencies

Analyze project dependency graph and record in vault knowledge.

## Procedure

1. Identify dependency sources (`package.json`, `Cargo.toml`, `go.mod`, etc.)
2. Scan import/use statements across source files (max 20 files)
3. Build module dependency graph, identify circular dependencies
4. Find most-imported modules (core modules)
5. Record in vault via MCP tool `vault_knowledge` section "Architecture"

## Output format

Use this exact format (markdown, not code block):

🔗 **Dependency Map — \<projectName\>**

### Core modules
- **\<module\>** — imported by N files, purpose: \<description\>

### External dependencies
- **\<library\>** — \<purpose\>, used in \<scope\>

### Module relationships
- **\<module A\>** → **\<module B\>** — \<relationship\>

### Circular dependencies
✅ None found / ⚠️ \<list\>

💡 Updated knowledge.md → Architecture

## Rules

- Read-only — never modify source code
- Focus on architecture-relevant dependencies, not every import

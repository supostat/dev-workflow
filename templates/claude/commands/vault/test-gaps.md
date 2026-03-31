# /vault:test-gaps — Find untested code

Analyze test coverage gaps and record as tech debt.

## Procedure

1. Identify test files (`tests/`, `__tests__/`, `*.test.ts`, `*_test.rs`, `*_test.go`)
2. Map each test file to the source file it covers
3. Find source files without tests (exclude types, constants, re-exports)
4. Analyze test quality for covered files
5. Run test suite if possible (`npm test` / `cargo test` / `go test ./...`)
6. Record findings via MCP tools

## Output format

Use this exact format (markdown, not code block):

🧪 **Test Coverage Gaps — \<projectName\>**

### 🔴 Untested
- **\<file\>** — \<reason it needs tests\>

### 🟡 Under-tested
- **\<file\>** (N tests) — Missing: \<specific gaps\>

### Quality
- ✅ \<positive observation\>
- ⚠️ \<issue\>

**Summary:** N/M source files tested. K need attention.

💡 Record as debt? (yes → /vault:debt for each gap)

## Rules

- Read-only — never create test files (that's the tester agent's job)
- Focus on significant gaps, not 100% coverage
- Prioritize: critical paths > error handling > edge cases > utility functions

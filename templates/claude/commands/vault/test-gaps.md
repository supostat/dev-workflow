# /vault:test-gaps — Find untested code

Analyze test coverage gaps and record as tech debt.

## Procedure

1. Identify test files:
   - Find all test files: `tests/`, `__tests__/`, `*.test.ts`, `*.spec.ts`, `*_test.rs`, `*_test.go`
   - Map each test file to the source file it covers

2. Find source files without tests:
   - List all source files in src/ (or equivalent)
   - Check which have corresponding test files
   - Exclude: types, constants, re-exports, generated files

3. Analyze test quality for covered files:
   - Count test cases per source file
   - Identify files with minimal coverage (1-2 tests for complex modules)
   - Check for missing edge case coverage (error paths, boundary values)

4. Run test suite if possible:
   - `npm test` / `cargo test` / `go test ./...`
   - Report pass/fail status

5. Record findings:
   - For each significant gap, use MCP tool `vault_record` type "debt":
     - Title: "Missing tests for <module>"
     - Content: what should be tested
   - Summary → use MCP tool `vault_knowledge` section "Testing"

## Output format

```
## Test Coverage Gaps

### Untested modules
- <file> — <reason it needs tests>

### Under-tested modules
- <file> — has N tests, needs: <specific gaps>

### Test quality issues
- <observation>

Summary: N/M source files have tests. K files need attention.
```

## Rules

- Read-only — never create test files (that's the tester agent's job)
- Focus on significant gaps, not 100% coverage
- Prioritize: critical paths > error handling > edge cases > utility functions

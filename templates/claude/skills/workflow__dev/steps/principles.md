# Engineering Principles

Every agent in this pipeline receives these principles as baseline quality bar.
Project-specific conventions (.dev-vault/conventions.md) override where they conflict.

## Architecture
- Single Responsibility: one module/file = one reason to change
- Dependency Rule: inner layers never import from outer layers
- Explicit dependencies: constructor/parameter injection, no hidden globals or singletons
- Boundaries: validate and sanitize at system entry points, trust internal code

## Error handling
- Fail fast at boundaries, recover gracefully inside
- Every error path must be tested
- No silent swallowing: catch → handle or propagate, never empty catch
- External calls (network, FS, DB) always have error handling and timeouts

## Production readiness
- No TODO/FIXME/HACK in committed code
- No debug logging (console.log/print) — use structured logging
- No hardcoded values that should be config or constants
- Idempotent operations where possible

## Code structure
- Max 300 lines per file, max 30 lines per function
- Extract when reused 2+ times OR > 5 lines of non-trivial logic
- Composition over inheritance
- No god objects, no utility dumps (helpers/, utils/, misc/)
- Types and names replace comments — if code needs a comment, rename or extract

## Testing
- Test behaviour, not implementation details
- One logical assertion per test
- No shared mutable state between tests
- Cover: happy path, edge cases (empty, null, boundary), error paths

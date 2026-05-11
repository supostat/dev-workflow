<!-- Thanks for the PR. Fill in the sections below — the maintainer reads them top-to-bottom.
     For security fixes, see SECURITY.md first; coordinate disclosure timeline before opening
     a public PR. -->

## What changed

<!-- One paragraph: what does this PR do? -->

## Why

<!-- The motivation. Bug? Feature? Refactor? Reference debt files or
     ADRs if applicable. -->

## How to verify

<!-- Reviewer's instructions: what to run, what to look at, what
     should be observably different. -->

```bash
pnpm test
pnpm lint
# any specific test files / commands you'd recommend running
```

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (requires major version bump per SemVer)
- [ ] Documentation only
- [ ] Refactor (no behavior change)
- [ ] Test-only

## Checklist

- [ ] `pnpm test` passes (838+ tests)
- [ ] `pnpm test:coverage` passes thresholds (80/82/78/71)
- [ ] `pnpm lint` (tsc --noEmit) clean
- [ ] CHANGELOG.md entry added under unreleased section
- [ ] Commit messages follow conventional-commits style
- [ ] Public API changes have JSDoc + matching tests
- [ ] For breaking changes: migration path documented

## Related

<!-- Issues, debts, ADRs, prior PRs. Use #issue-number for GitHub issues. -->

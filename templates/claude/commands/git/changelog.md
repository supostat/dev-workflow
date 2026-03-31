# /git:changelog — Generate changelog from git history

Generate a structured changelog from recent commits.

## Procedure

1. Determine range:
   - Default: since last tag (`git describe --tags --abbrev=0`)
   - Or: user-specified range (e.g., "last 20 commits")
   - Fallback: all commits on current branch vs main

2. Collect commits:
   - `git log <range> --oneline --no-merges`
   - `git log <range> --format="%H %s" --no-merges` for full info

3. Categorize by commit message:
   - **Added**: commits starting with "Add", "Implement", "Create"
   - **Changed**: "Update", "Refactor", "Improve", "Rename"
   - **Fixed**: "Fix", "Resolve", "Patch"
   - **Removed**: "Remove", "Delete", "Drop"
   - **Security**: "Security", "Harden", "CVE"
   - **Other**: everything else

4. Generate changelog:

```
## [Unreleased] — <today's date>

### Added
- <description> (<short hash>)

### Changed
- <description> (<short hash>)

### Fixed
- <description> (<short hash>)

### Removed
- <description> (<short hash>)
```

5. Output options:
   - Print to stdout (default)
   - Offer to prepend to CHANGELOG.md if it exists

## Rules

- Follow Keep a Changelog format (https://keepachangelog.com)
- Group related commits
- Skip merge commits
- Use present tense ("Add" not "Added")

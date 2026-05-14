---
name: profile
description: Activate a communication profile defined in .dev-vault/communication.yaml. Switches language, tone, verbosity, expertise level, and output format atomically via this slash. Reads, lists, sets, or clears the active profile.
allowed-tools: [Bash, Read, mcp__dev-workflow__profile_get, mcp__dev-workflow__profile_set, mcp__dev-workflow__profile_clear]
invocation: user
---

# /profile — Switch communication profile

Activate a profile defined in `.dev-vault/communication.yaml`. The active profile controls how Claude communicates: language, tone, verbosity, expertise level, output format. Profiles are defined in YAML and switched atomically via this slash.

## Usage

- `/profile` — Show current active profile + available list
- `/profile <name>` — Activate the named profile
- `/profile clear` — Reset to default (delete `.dev-vault/.profile-state`)

## Backend

Three MCP tools wired to `src/lib/communication-state.ts`:

| Tool | Purpose |
|---|---|
| `mcp__dev-workflow__profile_get` | Read state (active + default + available + config) |
| `mcp__dev-workflow__profile_set` | Persist active profile (validates name exists in yaml) |
| `mcp__dev-workflow__profile_clear` | Delete state file (fallback to yaml default) |

The slash is a thin wrapper — Claude calls the MCP tool, then renders the response.

## Procedure

### `/profile` (no argument)

1. Call `mcp__dev-workflow__profile_get`.
2. Render output (see "Output format: show" below).
3. If `configured: false` (no `.dev-vault/communication.yaml`), suggest:
   > Run `dev-workflow communication-template > .dev-vault/communication.yaml` to bootstrap.

### `/profile <name>`

1. Call `mcp__dev-workflow__profile_set({ name: "<name>" })`.
2. On success: render confirmation (see "Output format: switch").
3. On error from MCP (unknown name, missing config): show error message verbatim. The error includes the available profile list — present it as a numbered list and ask which to pick.

### `/profile clear`

1. Call `mcp__dev-workflow__profile_clear`.
2. Render confirmation that state file is gone; the next session-start will use the YAML default.

## Output format: show (`/profile`)

🎙️ **Communication profile**

- **Active:** \<active or "(default)" if state missing\>
- **Default:** \<from yaml active_profile\>
- **Available:** \<comma-separated list\>

\<key fields of effective profile\>:
- **Language:** \<language\>
- **Tone:** \<tone\>
- **Verbosity:** \<verbosity\>
- **Expertise:** \<expertise or "—"\>
- **Output:** \<output or "—"\>

## Output format: switch (`/profile <name>`)

🎙️ **Profile activated:** \<name\>

- **Language:** \<language\>
- **Tone:** \<tone\>
- **Verbosity:** \<verbosity\>
- **Output:** \<output or "—"\>

State persisted to `.dev-vault/.profile-state` (gitignored).

## Output format: clear (`/profile clear`)

🧹 **Profile state cleared.** Next session falls back to YAML default.

## Rules

- Slash MUST call the MCP tool — do NOT read/write `.profile-state` or `communication.yaml` directly via Read/Write/Bash. The MCP layer centralizes validation (name regex, profile-exists check) and atomic semantics.
- Profile validity is enforced by `profile_set` MCP handler — orchestrator does not need to pre-validate.
- If `communication.yaml` is missing, `/profile` and `/profile <name>` both surface a bootstrap suggestion. `/profile clear` is no-op (state file absent → exit clean).

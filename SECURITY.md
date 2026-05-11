# Security Policy

`@engramm/dev-workflow` ships defenses against shell injection (gateCommand
RCE), prompt injection (`escapeUserInput`), path traversal
(`sync-from-templates.sh`), and prototype pollution (`WorkflowState`). We
take vulnerability reports seriously — both for the package and for the
agent prompts it generates.

## Supported versions

Patches are issued for the latest minor release line. Older lines are
end-of-life immediately when a newer minor lands.

| Version  | Status                                            |
| -------- | ------------------------------------------------- |
| 1.0.x    | ✅ Supported (current stable)                      |
| 0.2.x    | ❌ End-of-life as of 2026-05-11 (use 1.0.x)        |
| 0.1.x    | ❌ End-of-life                                     |
| < 0.1    | ❌ End-of-life                                     |

If you cannot upgrade off an EOL version for a specific reason, open a
GitHub Discussion before the disclosure window so we can coordinate.

## Reporting a vulnerability

**Do not file a public GitHub issue for security reports.** Instead use
one of the private channels below:

1. **Preferred — GitHub Security Advisory (private):** open at
   [github.com/supostat/dev-workflow/security/advisories/new](https://github.com/supostat/dev-workflow/security/advisories/new).
   This routes the report only to maintainers and lets us coordinate a
   private fix branch.
2. **Fallback — email:** `ipugachev84@gmail.com` with subject
   `[dev-workflow security] <one-line summary>`. Please include
   reproduction steps, affected versions, and your suggested fix or
   workaround if any.

PGP/GPG-encrypted reports are welcome but not required.

## What to include

- **Affected version(s)** — exact `@engramm/dev-workflow@x.y.z` (run
  `npm list @engramm/dev-workflow`).
- **Attack class** — RCE / prompt injection / path traversal / disclosure
  / denial-of-service / supply-chain / other.
- **Reproduction** — minimum YAML / command / input that triggers the
  issue. If the repro involves a downstream consumer setup, please
  include the relevant `.dev-vault/workflows/`, `agents/`, or template
  files.
- **Impact** — what an attacker gains, prerequisites (write access to
  vault? network access? specific Node/npm version?), and your suggested
  CVSS-like rating if you have one.
- **Suggested fix** — optional, helpful but not required.

## Response timeline

| Stage                       | Target SLA                            |
| --------------------------- | ------------------------------------- |
| Initial acknowledgment      | within 72 hours                       |
| Triage + severity assessment| within 7 calendar days                |
| Fix shipped (CRITICAL/HIGH) | within 14 calendar days from triage   |
| Fix shipped (MEDIUM/LOW)    | next regular release cycle (~30 days) |
| Public disclosure           | coordinated with reporter, 90-day default |

These targets are best-effort — this is a single-maintainer project. If
the maintainer is unreachable for more than 7 days during an active
report, please escalate via GitHub Discussions (publicly visible, but
without disclosing details).

## Scope

### In scope

- **Shell injection** via any user-controllable input — `gateCommand`,
  task descriptions, custom agent prompts, workflow YAML fields,
  template substitutions.
- **Prompt injection** in agent prompts via `taskDescription`,
  `engramContext`, or previous step outputs.
- **Path traversal** in any file-reading or file-writing code path —
  `stepFile`, vault paths, template resolution, sync-from-templates,
  workflow loader, vault diff.
- **Prototype pollution** via `JSON.parse` on file/network input.
- **Privilege escalation** in agent permission model — Explore agent
  performing writes, coder/committer escaping their scoped permissions.
- **Supply-chain integrity** — npm package tampering, build pipeline
  compromise affecting published `dist/`.
- **Sensitive data disclosure** — secrets logged to `.dev-vault/`,
  engram trace files, or stdout.

### Out of scope

- **Voyage AI / OpenAI / Claude API key leaks via user-stored memories**
  — engram daemon stores what the user puts in. Don't put secrets in
  memory bodies. We document this in
  [`.dev-vault/knowledge.md`](.dev-vault/knowledge.md) "Engram trace may
  contain sensitive memory bodies".
- **Issues in upstream dependencies** — please report to the dependency
  maintainer. We'll bump and credit you.
- **Issues that require attacker write access to the local repository**
  but no actual security boundary crossing (e.g. "if I edit
  `.dev-vault/workflows/dev.yaml` I can change my own workflow"). The
  local vault is in the user's trust boundary by design.
- **Social engineering, phishing, physical access** — not our
  threat model.
- **DoS that requires the attacker to already control your shell** —
  same trust-boundary argument.

## Recognition

We credit reporters in:

- The fix commit message (`Reported-by: <name or alias>`)
- The CHANGELOG.md entry for the release that contains the fix
- The GitHub Security Advisory page

If you prefer to remain anonymous, please say so in the initial report.

## What we do NOT do

- We do not pay bug bounties.
- We do not have a Bug Bounty program partnership.
- We do not require NDAs for vulnerability reports.

## Public security history

| CVE / Advisory ID | Date       | Severity | Summary                                                 | Fix     |
| ----------------- | ---------- | -------- | ------------------------------------------------------- | ------- |
| (none yet)        | —          | —        | —                                                       | —       |

Historic security-relevant fixes shipped before this policy existed are
documented in [`CHANGELOG.md`](CHANGELOG.md) under each version's
"Security" subsection. The first releases under this policy are
`v1.0.0` (gateCommand RCE + gate-checker exception safety) and `v1.0.1`
(sync-from-templates path validation + prompt-injection defense +
prototype-pollution guard).

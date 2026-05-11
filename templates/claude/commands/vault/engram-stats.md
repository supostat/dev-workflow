# /vault:engram-stats — Engram timeline dashboard

Aggregated engram activity across recent workflow runs. Thin slash
wrapper around `dev-workflow engram-stats` CLI.

## Procedure

1. Parse args. Accepts `--runs N` (default 10) and `--json` (machine-
   readable).
2. Invoke `dev-workflow engram-stats [--runs N] [--json]` via Bash.
3. **Pretty mode (default)**: surface CLI output verbatim. The
   dashboard has 6 sections:
   - **Engram daemon panel**: live status (pending judgments, models-
     stale hint). `unavailable` if daemon down — local data still
     shown.
   - **Activity by method**: `memory_search` / `memory_store` /
     `memory_judge` counts, errors, average duration.
   - **Memory stores by type**: pattern / antipattern / decision /
     bugfix / context — extracted from trace JSONL params.
   - **By workflow step**: per-step search/store/judge breakdown
     using `step:<name>` tag from trace.
   - **Recent runs**: id / workflow / status / step progress /
     duration / telemetry counters (search/store/judge).
   - **Warnings**: e.g. `store > 0 && judge == 0` suggests agent
     missed feedback step.
4. **JSON mode**: relay the JSON verbatim — it's a stable contract
   for downstream tooling.

## Output format

Pretty output is multi-line plain text — surface as-is. JSON output
is a single JSON object — surface as a fenced ```json block ONLY when
user explicitly asked for machine-readable form.

When pretty output reaches the user, append a one-line summary:

📊 **Engram Dashboard relayed** — N runs covered, last activity at
`<cutoff ISO>`.

## When to use

- Diagnose engram learning loop health (pending judgments stuck high?)
- See per-step memory creation patterns
- Spot runs that stored memories without judging them
- Verify recent workflow runs left trace data

## Rules

- Do NOT interpret or re-format the dashboard — relay verbatim
- Do NOT modify any vault state — this is read-only
- If CLI exits non-zero, surface stderr verbatim and STOP
- `--runs N` is bounded by `Math.floor(N)` and clamped to >=1 by the
  CLI; invalid values silently default to 10

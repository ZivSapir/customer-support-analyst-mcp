# Milestone 6 — README, prompt, eval

Goal: a reviewer can clone, ingest, connect, and ask questions from the README alone.

## What we added

- README: clone-and-run, MCP config (Cursor / Claude Code / Codex), example questions, no API keys
- MCP **prompt** `ticket-analyst` — a reusable instruction for the host (not a database tool)
- `eval/questions.json` — **example** questions + expected tool routing (not a live LLM harness)
- `npm run verify` — pinned dataset checks (exact row counts, aggregates, FTS, filters, SQL guard / external FS, eval JSON shape)

No new database indexes in this milestone.

## MCP prompt vs tool

| | Tool | Prompt |
| --- | --- | --- |
| Hits DuckDB? | Yes | No |
| What it is | Function the model calls | Saved instructions the model can attach |
| Example | `query_tickets` | “Always SQL for counts” |

## Verify

```bash
npm run ingest   # if needed
npm run verify
```

Expected last line: `verify ok`.

`verify` fails if ingest silently lost rows (`ignore_errors=true` at ingest) because it asserts the pinned total **28587**, not merely “COUNT equals itself.”

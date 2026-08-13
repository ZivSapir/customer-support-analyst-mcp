# Milestone 6 — README, prompt, eval

Goal: a reviewer can clone, ingest, connect, and ask questions from the README alone.

## What we added

- README: clone-and-run, MCP config (Cursor / Claude Code / Codex), example questions, no API keys
- MCP **prompt** `ticket-analyst` — a reusable instruction for the host (not a database tool)
- `eval/questions.json` — sample questions and which tool should answer them
- `npm run verify` — schema, COUNT, search, and SQL-guard smoke test without Cursor

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

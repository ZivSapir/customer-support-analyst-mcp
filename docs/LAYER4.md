# Milestone 4 — `query_tickets`

Goal: answer count and filter questions with real SQL, not model guesses.

## What we added

- MCP tool `query_tickets` with one argument: `sql`
- `src/sql-guard.ts` — allow only a single `SELECT` / `WITH` statement; reject writes and multi-statement input
- `src/query.ts` — run the query read-only and cap results at 200 rows
- `zod` — declares the `sql` argument so the host knows what to pass

## How a call works

1. Host writes SQL (after `get_schema`).
2. Guard checks it is one read-only statement.
3. We wrap it in `SELECT * FROM ( ... ) LIMIT 200`.
4. DuckDB runs it on a **read-only** file connection.
5. JSON comes back: `columns`, `rowCount`, `truncated`, `rows`.

Two safety layers: keyword guard (fast reject) and DuckDB `OPEN_READONLY` (even a sneaky write should fail).

The guard is a heuristic, not a full SQL parser. Production would use warehouse roles / a real parser.

## Verify

1. `npm run build` and restart MCP in Cursor
2. Ask: **How many tickets are in the dataset?**
3. Expected: host calls `get_schema` (optional) then `query_tickets` with `SELECT COUNT(*) ...` and returns **28587** (after ingest)

Also confirm a write is rejected, e.g. `DROP TABLE tickets`.

# Milestone 3 — `get_schema`

Goal: give the host a map of the local `tickets` table before it tries to query.

## What we added

- `get_schema` MCP tool (no arguments)
- `src/schema.ts` — reads DuckDB and returns JSON
- Read-only DuckDB open in `src/db.ts` (`withReadOnlyConnection`)

The tool returns:

- column names and DuckDB types
- full distinct values for `type`, `queue`, `priority`, `language`
- row count
- routing notes (SQL vs text search)
- filter/casing notes so the host does not guess labels

## Why this milestone exists

The client LLM does not know our columns. `get_schema` is the first call so later SQL uses real names and real filter values.

If `data/tickets.duckdb` is missing, the tool returns an error telling the user to run `npm run ingest`. The server process stays up.

## Verify

1. `npm run ingest` (if you have not already)
2. `npm run build`
3. Restart the MCP server in Cursor
4. Ask: **Use get_schema on the support-analyst MCP server**

Expected: JSON with `table: "tickets"`, columns, `filter_values`, and `routing`.

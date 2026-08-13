# Milestone 2 — Ingest (CSV -> DuckDB)

Goal: prepare a local analytical database file before adding query tools.

## What we added

- `duckdb` dependency in `package.json`
- `src/db.ts` for tiny DB helpers (connect/run/all)
- `src/ingest.ts` to:
  1. create `data/`
  2. download CSV from Hugging Face (first run only)
  3. build `tickets` table in `data/tickets.duckdb`
  4. print row count

## Why this milestone exists

- We keep setup separate from MCP runtime.
- Analysts should ask questions without waiting for network every time.
- Local DuckDB gives deterministic data for repeatable answers.

## Run it

```bash
npm run ingest
```

Expected output ends with:

`Created DuckDB at .../data/tickets.duckdb with <row_count> rows`

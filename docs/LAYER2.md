# Milestone 2 — Ingest (CSV -> DuckDB)

Goal: prepare a local analytical database file before adding query tools.

## What we added

- `@duckdb/node-api` (DuckDB Node Neo) in `package.json`
- `src/dataset.ts` — pinned HF revision, CSV sha256, expected row count
- `src/db.ts` for DB helpers (`DuckDBInstance` / promise `run` + `all`)
- `src/ingest.ts` to:
  1. create `data/`
  2. download **pinned** CSV (or reuse cache only if sha256 matches)
  3. build `tickets` into `tickets.duckdb.tmp`, then atomically replace `tickets.duckdb`
  4. write `data/ingest-manifest.json` (dataset, revision, hash, row_count, time)
  5. print row count

Ingest does **not** use `ignore_errors` — malformed CSV fails the run.

## Why this milestone exists

- We keep setup separate from MCP runtime.
- Analysts should ask questions without waiting for network every time.
- Local DuckDB + pinned provenance gives deterministic data for repeatable answers.

## Run it

```bash
npm run ingest
```

Expected output ends with:

`Created DuckDB at .../data/tickets.duckdb with <row_count> rows`

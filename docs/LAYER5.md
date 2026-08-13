# Milestone 5 — `search_tickets`

Goal: find tickets by customer wording (themes, paraphrases), not by counting them.

## What we added

- Ingest builds a DuckDB **FTS** (full-text search) index on `subject` and `body`
- MCP tool `search_tickets`
  - `query` — search terms
  - `k` — how many hits (default 5, max 20)
  - `language` — optional `en` or `de`
- `src/search.ts` — `LOAD fts`, BM25 rank, return previews

**FTS** means: split text into words, index them, then rank documents with **BM25** (a standard keyword-relevance score). It is not embeddings and not a count.

## Why not SQL `LIKE`

`LIKE '%refund%'` misses “refunded”, “money back”, and ranking. Search is for *which tickets talk about this*. Volume still goes through `query_tickets`.

## Verify

1. `npm run ingest` (required once — creates the FTS index)
2. `npm run build` and restart MCP in Cursor
3. Ask: **What are customers saying about refunds?**

Expected: `search_tickets` returns ranked `ticket_id`s with scores. The host should **not** treat `resultCount` as “how many refund tickets exist.”

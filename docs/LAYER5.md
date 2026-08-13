# Milestone 5 — search tools (FTS)

Goal: find tickets by **lexical** customer wording, and count how many match — without treating top-k hits as volume or claiming semantic paraphrase search.

## What we added

- Ingest builds a DuckDB **FTS** (full-text search) index on `subject` and `body`
- MCP tool `search_tickets`
  - `query` — search terms
  - `k` — how many hits (default 5, max 20)
  - optional filters: `language`, `priority`, `queue`, `type`
- MCP tool `search_metrics`
  - same BM25 match predicate as `search_tickets`
  - `COUNT(*)` of matches, optional `group_by` (`queue` / `priority` / `type` / `language`)
  - same optional structured filters
- `src/search.ts` — `LOAD fts`, BM25 rank or aggregate

**FTS** means: tokenize text, optionally stem (DuckDB default: Porter), index terms, then rank with **BM25**. It is **lexical** retrieval — not embeddings and not synonym/paraphrase resolution (`refund` ↛ `money back`).

## Why not SQL `LIKE`

`LIKE '%refund%'` misses stemming (e.g. `refunded`) and ranking. FTS helps with morphologically related wording. It does **not** find semantic paraphrases; that would need hybrid/embedding search (out of v1 on purpose).

Structured volume stays on `query_tickets`; **lexical match volume** uses `search_metrics`.

## Routing

| Need | Tool |
| --- | --- |
| Keyword/topic examples | `search_tickets` |
| “How many lexically match X?” / group by queue | `search_metrics` |
| Counts on typed columns only | `query_tickets` |

Report `search_metrics` as **FTS match volume**, not a human semantic class of all related tickets.

## Verify

1. `npm run ingest` (required once — creates the FTS index)
2. `npm run build` and restart MCP in Cursor
3. Ask: **What are customers saying about refunds?** → `search_tickets`
4. Ask: **How many tickets mention refunds?** → `search_metrics`

Expected: ranked hits for (3); a `match_count` (and optional groups) for (4). Never treat `search_tickets` `resultCount` as census.

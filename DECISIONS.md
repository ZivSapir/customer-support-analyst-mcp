# Decision log — Customer Support Analyst MCP

Architecture and rejected alternatives for the submission. Prefer this file over repeating the same rationale in README.

## Product

**Who:** Support analysts / ops (not customers).  
**What:** Natural-language Q&A over a local ticket dataset — exact counts + lexical examples.  
**Not:** Customer chatbot, ticket writer, or auto-router.

## MCP shape

| Choice | Why |
| --- | --- |
| stdio MCP server | Clone-and-run; host (Cursor / Claude Code / Codex) plans tool calls |
| No server-side LLM / API keys | Numbers stay auditable; host already has a model |
| TypeScript + official MCP SDK | Mature SDK; fits local stdio |
| Read-only tools only | Analyst read path; no writes / web UI / agent frameworks |

**Production:** Use CHEQ’s standard service/runtime stack; preserve the MCP tool contract (different store/runtime, same tools).

## Data store

**Chosen:** DuckDB via `@duckdb/node-api` (local `data/tickets.duckdb`).

| Need | Fit |
| --- | --- |
| Exact aggregates | Analytics SQL |
| Local, no infra | Embedded file |
| Lexical text search | FTS extension (BM25) |
| Auditable answers | Query + result to host |

**Rejected:** SQLite (weaker analytics ergonomics); Postgres/Snowflake for v1 (wrong for local); vector-DB-only (cannot answer “how many?”); embeddings in v1 (API key + opaque scores).

**Ingest:** Separate `npm run ingest` — pinned HF revision, CSV sha256, atomic DB replace, `ingest-manifest.json`. Tables: `tickets` + normalized `ticket_tags(ticket_id, tag)`.

**Dataset:** [Tobi-Bueck/customer-support-tickets](https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets) (assignment Support_Dataset link).

## Tool contract

| Tool | Contract |
| --- | --- |
| `ping` | Health / troubleshooting only |
| `get_schema` | Columns + semantic field descriptions + filter/tag values + routing |
| `query_tickets` | Host SQL for structured counts/filters; caps + heuristic guard; DB read-only + external access off |
| `search_tickets` | Minimal ranked lexical examples (`relevance_score` = ranking only); not volume |
| `search_metrics` | Lexical FTS match volume / group-by — **not** semantic topic prevalence |
| `get_ticket` | One-ticket detail; `data_envelope` marks text as untrusted |

Correctness comes from **tool contracts**, not prompt obedience. The optional `ticket-analyst` prompt reinforces routing; it is not the security or metrics boundary.

**FTS vs LIKE:** BM25 uses an inverted index, stemming, and ranking. `LIKE '%x%'` is substring-only. FTS is still **lexical** — not paraphrase/embedding search (`refund` ↛ `money back`). Dataset is EN+DE; SQL works for both; FTS analyzer is English-default (DE best-effort).

**Security (v1 honesty):** Keyword guard is a convenience filter, not a sandbox. Host-SQL paths use `READ_ONLY` + `enable_external_access=false` (after startup `LOAD fts`). Risk remains: over-broad SQL, resource exhaustion, and ticket text as prompt-injection into the host model. Production: SELECT-only identity, governed views, query budgets/timeouts; prefer a typed analytics API over free SQL from the model.

## Runtime details

- Shared read-only DuckDB connection for the MCP process lifetime (`LOAD fts` once, then disable external access).
- Search values bound via prepared parameters (no hand-escaped FTS query strings).
- Tool annotations: `readOnlyHint`, `destructiveHint: false`, `openWorldHint: false`.
- Results still JSON-in-text (`structuredContent` deferred).

## Deliberately deferred

- Typed `analyze_tickets` (parameterized aggregates, no host SQL) — stronger contract; keep `query_tickets` for this assignment’s auditable-SQL story; production direction.
- Dual EN/DE FTS indexes; embeddings / hybrid search.
- Full MCP `outputSchema` / `structuredContent`.

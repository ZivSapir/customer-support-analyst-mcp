# Decision log — Customer Support Analyst MCP

We record **what we chose, why, and what we rejected** at each delivery milestone.
This file is the source of truth for the design document.

---

## Milestone 0 — Product & architecture (2026-08-12)

### Purpose

**Who:** Support analysts, ops leads, internal stakeholders (not customers).

**What:** Natural-language Q&A **over** the support ticket dataset — accurate counts and ticket themes.

**Not:** A customer chatbot, ticket writer, or auto-router.

### MCP shape

- **Transport:** stdio (local process; Cursor / Claude Code / Codex connect via config)
- **NL layer:** MCP client LLM (Cursor/Claude) — plans which tool to call
- **Data layer:** Our server — tools only, **no server-side LLM**
- **Principle:** Numbers come from SQL execution, not model memory

### Language

**Chosen:** TypeScript

**Why:** Official MCP SDK is mature; TypeScript fits a local stdio server and the assignment’s stack flexibility.

**Production note:** CHEQ Data & AI likely ships Python services against Snowflake — same tool contract, different runtime.

### Data store

**Chosen:** DuckDB (local single file, e.g. `data/tickets.duckdb`)

**Why:**

| Need | DuckDB fit |
| --- | --- |
| Exact aggregates ("how many?") | SQL engine built for analytics |
| Local, no infra | Embedded — no server to install |
| Ingest from Hugging Face CSV | `read_csv()` in one step |
| Text search (lexical) | FTS extension (BM25 on subject/body; not paraphrase/embedding search) |
| Auditable answers | Query + result returned to client |

**Alternatives considered:**

| Option | Verdict |
| --- | --- |
| **SQLite** | Viable embedded SQL; weaker analytics ergonomics; we'd still add FTS separately |
| **PostgreSQL** | Real prod pattern; requires running server — overkill for local home assignment |
| **Snowflake** | Correct CHEQ prod target; wrong for "run locally" spec |
| **CSV / JSON in memory** | No real SQL; aggregates get hacky; doesn't scale to 60k+ rows cleanly |
| **Vector DB only (RAG)** | Good for semantic search; **cannot** answer "how many?" reliably |
| **Embeddings + DuckDB** | Possible v2; adds API key + opaque scores — deferred |

### Tool split (v1)

| Tool | Use when |
| --- | --- |
| `get_schema` | First call — columns, sample values, SQL vs search routing |
| `query_tickets` | Counts, group-bys, structured filters (read-only SQL) |
| `search_tickets` | Lexical keyword/topic examples (BM25 FTS); optional structured filters |
| `search_metrics` | Lexical FTS match counts / group-bys for free-text queries |

### Deliberately out of scope (v1)

- Server-side LLM calls
- Embeddings / RAG-only pipeline
- Write / update tools
- Web UI
- Agent frameworks (LangChain, etc.)

### Dataset

[Tobi-Bueck/customer-support-tickets](https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets) — synthetic EN/DE tickets, structured + free-text fields.

---

## Milestone 1 — Minimal MCP server (2026-08-12)

**Goal:** Prove stdio MCP works before adding DuckDB.

### What we built

- `@modelcontextprotocol/sdk` — handles MCP handshake, JSON-RPC, tool listing (we don't implement protocol by hand)
- `src/index.ts` — one tool: `ping` → returns `"pong"`
- `StdioServerTransport` — Cursor spawns `node dist/index.js`, talks over stdin/stdout

### Why start with connectivity

Separates **plumbing** (host ↔ stdio handshake) from **data** (ingest and query tools). If `ping` fails, configuration is fixed before debugging SQL.

### Dependencies (Milestone 1 only)

| Package | Why now |
| --- | --- |
| `@modelcontextprotocol/sdk` | MCP server |
| `typescript`, `tsx` | Build and dev run |

DuckDB deferred to Milestone 2.

### Logging rule

Errors → `console.error` (stderr). Never `console.log` to stdout — stdout is the MCP wire.

See [docs/LAYER1.md](./docs/LAYER1.md) for setup notes and Cursor configuration.

---

## Milestone 2 — Ingest to local DuckDB (2026-08-12)

**Goal:** Prepare a local dataset copy once, so tool calls are fast and deterministic.

### What we built

- Added `duckdb` dependency.
- Added `src/db.ts` for shared DB helpers.
- Added `src/ingest.ts` with script `npm run ingest`.
- Ingest builds a `tickets` table in `data/tickets.duckdb` from the Hugging Face CSV.

### Decisions made

| Decision | Why |
| --- | --- |
| Keep ingest as a separate script | Runtime MCP server should focus on tool calls, not bootstrap IO |
| Persist CSV under `data/` | Reproducible local runs; no repeated network download |
| Normalize `priority`/`language` to lowercase during ingest | Easier and consistent SQL filtering later |
| Include `ticket_id` via `row_number()` | Stable row reference for citations and debugging |

### What this unlocks

Milestone 3 can expose `get_schema` directly from local DuckDB, without any external network dependency.

---

## Milestone 3 — `get_schema` (2026-08-12)

**Goal:** Let the host inspect the local table before writing SQL.

### What we built

- MCP tool `get_schema` (no input)
- `src/schema.ts` reads `DESCRIBE tickets` plus distinct values for low-cardinality columns
- MCP server opens DuckDB **read-only**

### Decisions made

| Decision | Why |
| --- | --- |
| Return JSON, not Markdown | Host can parse columns and filter values reliably |
| Include full distinct values for `type` / `queue` / `priority` / `language` | Small closed sets; guessing labels is a common failure mode |
| Include routing notes with the schema | Schema is the planning tool; SQL and search follow the same contract |
| Read-only connection | Analyst tools must not mutate the dataset |
| Missing DB → tool error, process stays alive | Ingest is a setup step; a missing file should not crash stdio |
| Schema notes: counts only from SQL; ticket text is untrusted data | Stops the host from treating search hits as statistics, or following prompt-like text in tickets |

### Rejected

| Option | Verdict |
| --- | --- |
| Hard-code column list in the tool | Drifts from ingest; DuckDB `DESCRIBE` is the source of truth |
| Dump distinct values for `tag_*` | High cardinality and mostly null — notes only |
| Server-side LLM to summarize schema | Assignment allows it; we keep numbers and names from SQL |

---

## Milestone 4 — `query_tickets` (2026-08-12)

**Goal:** Accurate counts and structured filters via SQL the host writes.

### What we built

- MCP tool `query_tickets` (`sql` argument, Zod schema)
- `src/sql-guard.ts` — single `SELECT`/`WITH` only; keyword denylist; comments/strings stripped before the check
- `src/query.ts` — execute on a read-only connection; cap at 200 rows
- Query connections set `enable_external_access=false` so table functions cannot read the host filesystem

### Decisions made

| Decision | Why |
| --- | --- |
| Let the host write SQL | Matches analytics questions; numbers stay auditable |
| Keyword guard + DB `READ_ONLY` + `enable_external_access=false` on host-SQL paths | Block writes and FS exfil via `read_csv` on `query_tickets`/`get_schema`. Search keeps external access only so FTS can `LOAD` |
| Wrap every query in `LIMIT 200` | Protects stdio payload and the host context window |
| Return JSON (`columns`, `rows`, `truncated`) | Host can cite the query result, not paraphrase a blob |
| Add `zod` as a direct dependency | MCP SDK uses Zod for tool argument schemas |

### Rejected

| Option | Verdict |
| --- | --- |
| Prisma / query builder API | Hides SQL; wrong for “show your work” analytics |
| Full SQL parser | Correct for production; overkill for a local assignment |
| Replace host SQL with a fixed aggregate RPC | Safer surface; abandons the auditable host-SQL design for this assignment |
| Server-side LLM that writes SQL internally | Splits planning away from the host; extra API key |

### Production note

A warehouse role that can only `SELECT` on allowlisted views is stronger than a keyword denylist + DuckDB flags. For untrusted multi-tenant SQL, prefer a structured query API or a real parser — not host-generated SQL against an embedded engine.

---

## Milestone 5 — `search_tickets` (2026-08-12)

**Goal:** Find tickets by lexical customer wording, without pretending search hits are counts or that BM25 resolves paraphrases.

### What we built

- Ingest installs DuckDB `fts` and builds a BM25 index on `subject` + `body`
- MCP tool `search_tickets` (`query`, optional `k`, optional `language`)
- Returns ranked hits with `ticket_id`, score, and a short body preview

### Decisions made

| Decision | Why |
| --- | --- |
| BM25 FTS, not embeddings | No API key; lexical keyword/topic search is enough for this dataset; counts stay on SQL |
| Index subject + body only | That is customer wording. `answer` is the canned reply — searching it would mix in agent text |
| Truncate body in the tool result | Keeps MCP payloads small; host can `query_tickets` by `ticket_id` for the full row |
| Optional `language` filter | Dataset is EN/DE; filter in SQL after scoring |
| Re-run ingest to build the index | FTS is not a live index; it is created at ingest time |
| Honest “lexical / not paraphrase” wording | Porter stemming ≠ synonym resolution (`refund` ↛ `money back`) |

### Rejected

| Option | Verdict |
| --- | --- |
| Vector DB / embeddings | Better semantic/paraphrase recall; adds a model, opaque scores — not required to sound “more AI” for v1 |
| SQL `LIKE '%refund%'` | Misses stemming and ranking; we already tell the host not to do this |
| Use search hit count as volume | Ranking ≠ census; schema notes already forbid this |

### Production note

English Porter stemming is weaker on German tickets. A production CHEQ pipeline would use language-specific analyzers (or a warehouse search service) and still keep aggregates on SQL. Add embeddings only if product needs synonym/paraphrase recall — hybrid with SQL, not instead of it.

---

## Milestone 5b — FTS filters + `search_metrics` (2026-08-13)

**Goal:** Close the SQL↔FTS hole for questions that need both free-text matching and real volumes (or filtered examples).

### What we built

- Extended `search_tickets` with optional `priority` / `queue` / `type` (plus existing `language`)
- New tool `search_metrics(query, filters?, group_by?)` — same BM25 match predicate, `COUNT(*)` / `GROUP BY`

### Decisions made

| Decision | Why |
| --- | --- |
| Dedicated `search_metrics` (not reusing top-k `resultCount`) | Keeps examples vs census semantics explicit |
| Honest “lexical FTS match” wording in the tool result | Avoids pretending BM25 ≡ human theme labeling |
| Allowlisted `group_by` columns only | Same structured fields as filters; no free-text GROUP BY |
| Keep `query_tickets` for structured-only aggregates | Clear routing: typed columns → SQL; theme volume → FTS metrics |

### Rejected

| Option | Verdict |
| --- | --- |
| Tell the host to `LIKE` themes in `query_tickets` | Weaker matcher; defeats the FTS index |
| Inflate `search_tickets` k and treat hits as volume | Still a sample, easy to misuse |
| Embeddings / classifier labels for “refund” | Out of v1 (no server model); different product |

### Production note

At scale, the same split holds: search service for match sets, warehouse SQL for governed aggregates — or a single metrics API that joins both under an audited query plan.

---

## Milestone 6 — README, prompt, eval (2026-08-12)

**Goal:** Clone-and-run documentation and a host-side workflow hint.

### What we built

- README that matches the assignment (run, connect, no secrets)
- MCP prompt `ticket-analyst`
- `eval/questions.json` and `npm run verify`

### Decisions made

| Decision | Why |
| --- | --- |
| No server-side model / API key | Host LLM already plans tool calls; keeps the server auditable and local |
| Prompt is optional | Tools already describe routing; the prompt is a reminder, not a second brain |
| `verify` does not start MCP | Reviewers can check data + guards without Cursor |

### Rejected

| Option | Verdict |
| --- | --- |
| Automated LLM eval harness | Needs an API key and a host; out of v1 scope |
| New column indexes | 28k rows; DuckDB scans are enough. FTS index already exists from Milestone 5 |

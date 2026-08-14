# Customer Support Analyst MCP

Local [Model Context Protocol](https://modelcontextprotocol.io) server for natural-language Q&A over a customer-support ticket dataset. Built for analysts and ops — not a customer-facing chatbot.

## Model

This MCP server does **not** call an LLM itself. Natural-language planning is performed by the MCP **host**.

**Tested with:**

- Cursor Agent (host-configured model)

No `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is required by this server. The model is whatever the host already uses.

## How it works

| Tool | Use for |
| --- | --- |
| `ping` | Health check / troubleshooting (MCP config smoke test) |
| `get_schema` | Compact fields, small filter enums, table counts, and SQL vs search routing |
| `query_tickets` | Counts, group-bys, structured filters (read-only SQL; results labeled untrusted) |
| `search_tickets` | Lexical keyword/topic examples (BM25); minimal hits + `relevance_score` (ranking only); subjects labeled untrusted |
| `get_ticket` | One ticket by id (detail after search; text marked untrusted) |
| `search_metrics` | Lexical FTS match counts / group-bys for free-text queries |

Structured counts come from `query_tickets` (including `ticket_tags` for label analytics). Match volumes come from `search_metrics` (lexical FTS only — **not** semantic topic prevalence). `search_tickets` hits are ranked examples, not volume — use `get_ticket` for body/answer. Ticket subject/body/answer are **untrusted model input**.

`get_schema` intentionally omits the 1,255-value tag vocabulary to keep first-call context small. Discover relevant tags through an aggregate `query_tickets` query on `ticket_tags`.

FTS uses an inverted index, stemming, and BM25 ranking — better than SQL `LIKE` for examples, still **not** paraphrase/embedding search. Multi-word queries default to `match_mode: "any"` (at least one term); use `"all"` when every term should be present. Neither mode is exact phrase matching. The dataset is EN+DE; SQL works for both languages. FTS uses DuckDB’s default **English** analyzer, so German text search is best-effort.

**Dataset:** [Tobi-Bueck/customer-support-tickets](https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets) (Hugging Face Support_Dataset linked from the assignment; downloaded once at ingest).

Architecture and rejected alternatives: [DECISIONS.md](./DECISIONS.md).

## Requirements

- Node.js 20+
- npm
- An MCP host (Cursor, Claude Code, or Codex)

## Quick start

```bash
git clone https://github.com/ZivSapir/customer-support-analyst-mcp.git
cd customer-support-analyst-mcp
npm install
npm run ingest   # downloads CSV (first run), builds local DuckDB + FTS index
npm run build
npm run verify   # optional: schema, count, search, SQL guard
npm start        # stdio MCP server — normally the host spawns this
```

`data/` is gitignored. Each machine runs ingest locally against a **pinned** Hugging Face revision (see `src/dataset.ts`); the CSV checksum is verified and `data/ingest-manifest.json` records provenance.

## MCP configuration

Use the **absolute path** to this repo. After changing tools, restart the MCP server (or reload the window) so the host picks up the new tool list.

### Cursor

User or project config (`.cursor/mcp.json` / `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "customer-support-analyst": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/customer-support-analyst-mcp/dist/index.js"]
    }
  }
}
```

You should see `ping`, `get_schema`, `query_tickets`, `search_tickets`, `get_ticket`, and `search_metrics`. If `ping` fails, fix MCP configuration before debugging SQL.

### Claude Code

Same JSON in Claude Code MCP settings (or `~/.claude/claude_desktop_config.json`, depending on install).

### Codex

Same `mcpServers` block in the Codex MCP config for your install.

Example file: [mcp.config.example.json](./mcp.config.example.json).

## Example questions

| Question | Expected tool |
| --- | --- |
| How many tickets are in the dataset? | `query_tickets` |
| High-priority tickets by queue | `query_tickets` |
| Breakdown by language and priority | `query_tickets` |
| What are customers saying about refunds? | `search_tickets` |
| Password-reset tickets in German (by language column) | `query_tickets`, or `search_tickets` with `language: "de"` and preferably `match_mode: "all"` (FTS is English-optimized) |
| How many tickets mention refunds? | `search_metrics` |
| High-priority tickets about password resets (examples) | `search_tickets` with filters |
| How many tickets have the Refund tag? | `query_tickets` on `ticket_tags` |

Optional MCP prompt: `ticket-analyst` (reminder only — routing lives in tool contracts + `get_schema`).

Full list of example questions (routing hints for reviewers — **not** an automated LLM eval harness): [eval/questions.json](./eval/questions.json). `npm run verify` checks that file’s shape and pinned DuckDB/FTS expectations.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run ingest` | Pinned CSV → `data/tickets.duckdb` + FTS + ingest manifest |
| `npm run peek` | Print columns + sample rows from local DuckDB |
| `npm run build` | Compile `src/` → `dist/` |
| `npm start` | Run the stdio server |
| `npm run verify` | Pinned smoke checks (row counts, filters, FTS, SQL guard/FS, eval JSON shape) |

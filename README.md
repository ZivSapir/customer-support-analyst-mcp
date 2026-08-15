# Customer Support Analyst MCP

Local [Model Context Protocol](https://modelcontextprotocol.io) server for natural-language Q&A over a customer-support ticket dataset. Built for analysts and ops - not a customer-facing chatbot.

## Model

This MCP server does **not** call an LLM itself. Natural-language planning is performed by the MCP **host**. The server is model-agnostic: it uses whatever model the host already has configured.

**Tested end-to-end with:**

- Cursor Agent - Composer

**Also runnable with** Claude Code and Codex (same stdio server; configuration below).

No `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is required by this server. The host's configured model performs planning; this process only executes tools.

## How it works

| Tool | Use for |
| --- | --- |
| `ping` | Health check / troubleshooting (MCP config smoke test) |
| `get_schema` | Compact fields, small filter enums, table counts, and SQL vs search routing |
| `query_tickets` | Counts, group-bys, structured filters (read-only SQL; results labeled untrusted) |
| `search_tickets` | Lexical keyword/topic examples (BM25); minimal hits + `relevance_score` (ranking only); subjects labeled untrusted |
| `get_ticket` | One ticket by id (detail after search; text marked untrusted) |
| `search_metrics` | Lexical FTS match counts / group-bys for free-text queries |

Structured counts come from `query_tickets` (including `ticket_tags` for label analytics). Match volumes come from `search_metrics` (lexical FTS only - **not** semantic topic prevalence). `search_tickets` hits are ranked examples, not volume - use `get_ticket` for body/answer. Ticket subject/body/answer are **untrusted model input**.

`get_schema` intentionally omits the 1,255-value tag vocabulary to keep first-call context small. Discover relevant tags through an aggregate `query_tickets` query on `ticket_tags` (use `COUNT(DISTINCT ticket_id)` for ticket counts). Wording questions ("mention/say/contain X") use `search_metrics`; explicit labels use `ticket_tags` - do not treat one as the other.

FTS uses an inverted index, stemming, and BM25 ranking - better than SQL `LIKE` for examples, still **not** paraphrase/embedding search. Multi-word queries default to `match_mode: "any"` (at least one term); use `"all"` when every term should be present. Neither mode is exact phrase matching. The dataset is EN+DE; SQL works for both languages. FTS uses DuckDB's default **English** analyzer, so German text search is best-effort.

**Dataset:** [Tobi-Bueck/customer-support-tickets](https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets) (Hugging Face Support_Dataset; downloaded once at ingest).

Architecture and rejected alternatives: [DECISIONS.md](./DECISIONS.md).

## Requirements

- Node.js 20+
- npm (setup only: install / ingest / build / verify)
- An MCP host (Cursor, Claude Code, or Codex)

## Quick start

Three stages: **install** and **prepare** are yours; **connect** is the host spawning Node.

### 1. Install

```bash
git clone https://github.com/ZivSapir/customer-support-analyst-mcp.git
cd customer-support-analyst-mcp
npm ci
```

### 2. Prepare

```bash
npm run ingest   # downloads CSV (first run), builds local DuckDB + FTS index
npm run build    # compiles src/ → dist/index.js
npm run verify   # optional: pinned smoke checks
```

`data/` is gitignored. Each machine runs ingest locally against a **pinned** Hugging Face revision (see `src/dataset.ts`); the CSV checksum is verified and `data/ingest-manifest.json` records provenance.

After this step you should have:

- `data/tickets.duckdb`
- `dist/index.js` (the MCP server entrypoint)

### 3. Connect (ask questions in the host)

Do **not** leave `npm start` running in a terminal to "use" the app. This is a **stdio MCP server**: Claude Code / Codex / Cursor **spawn** the process when they need tools:

```text
MCP host (Claude Code / Codex / Cursor)
  → spawns:  node /ABSOLUTE/PATH/TO/customer-support-analyst-mcp/dist/index.js
  → talks over stdin/stdout
  → you ask natural-language questions in the host chat
```

**Next step:** pick your host under [MCP configuration](#mcp-configuration) and paste that JSON/TOML block. Replace `/ABSOLUTE/PATH/TO/customer-support-analyst-mcp` with the real clone path on your machine (the folder that contains `dist/index.js` after `npm run build`). Prefer **`node` + that absolute `dist/index.js` path** (not `npm start`), so the working directory cannot break startup. Reload/restart MCP in the host, confirm the tools appear, then ask a question in chat.

Optional: `npm start` is only a manual check that the process boots; it waits for an MCP client on stdin/stdout and is not the normal way to ask questions.

## MCP configuration

Replace `/ABSOLUTE/PATH/TO/customer-support-analyst-mcp` with your clone path (example: `/Users/you/code/customer-support-analyst-mcp`). The `args` entry must point at `dist/index.js` inside that folder. After changing tools, restart/reload the MCP server in the host so it picks up the new tool list.

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

You should see `ping`, `get_schema`, `query_tickets`, `search_tickets`, `get_ticket`, and `search_metrics`. If the server or `ping` is unavailable, verify the absolute path, build output (`dist/index.js`), and local ingest (`npm run ingest`) before debugging dataset queries.

### Claude Code

Project-scoped `.mcp.json` in the repo root:

```json
{
  "mcpServers": {
    "customer-support-analyst": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/customer-support-analyst-mcp/dist/index.js"]
    }
  }
}
```

Or via CLI: `claude mcp add --transport stdio customer-support-analyst -- node /ABSOLUTE/PATH/TO/customer-support-analyst-mcp/dist/index.js`

### Codex

Add to `~/.codex/config.toml` (or project-scoped `.codex/config.toml` in a trusted project):

```toml
[mcp_servers.customer-support-analyst]
command = "node"
args = ["/ABSOLUTE/PATH/TO/customer-support-analyst-mcp/dist/index.js"]
```

Or via CLI: `codex mcp add customer-support-analyst -- node /ABSOLUTE/PATH/TO/customer-support-analyst-mcp/dist/index.js`

Cursor example file: [mcp.config.example.json](./mcp.config.example.json).

## Example questions

| Question | Expected tool |
| --- | --- |
| How many tickets are in the dataset? | `query_tickets` |
| High-priority tickets by queue | `query_tickets` |
| Breakdown by language and priority | `query_tickets` |
| What are customers saying about refunds? | `search_tickets` |
| Password-reset tickets in German (by language column) | `query_tickets`, or `search_tickets` with `language: "de"` and preferably `match_mode: "all"` (FTS is English-optimized) |
| How many tickets mention refunds? | `search_metrics` (lexical wording - not the Refund tag) |
| High-priority tickets about password resets (examples) | `search_tickets` with filters; prefer `match_mode: "all"` for multi-word topics |
| How many tickets have the Refund tag? | `query_tickets` on `ticket_tags` with `COUNT(DISTINCT ticket_id)` |

Optional MCP prompt: `ticket-analyst` (reminder only - routing lives in tool contracts + `get_schema`).

Full list of example questions (routing hints for operators - **not** an automated LLM eval harness): [eval/questions.json](./eval/questions.json). `npm run verify` checks that file's shape and pinned DuckDB/FTS expectations.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run ingest` | Pinned CSV → `data/tickets.duckdb` + FTS + ingest manifest |
| `npm run peek` | Print columns + sample rows from local DuckDB |
| `npm run build` | Compile `src/` → `dist/` |
| `npm run verify` | Pinned smoke checks (row counts, filters, FTS, SQL guard/FS, eval JSON shape) |
| `npm run dev` | Run the stdio server via `tsx` (development) |
| `npm start` | Alias for `node dist/index.js` - manual stdio boot check only; hosts should spawn Node themselves |

# Customer Support Analyst MCP

Local [Model Context Protocol](https://modelcontextprotocol.io) server for natural-language Q&A over a customer-support ticket dataset. Built for analysts and ops — not a customer-facing chatbot.

The **host** (Cursor, Claude Code, or Codex) handles natural language. This process exposes tools only. It does **not** call an LLM and needs **no API keys**.

## How it works

| Tool | Use for |
| --- | --- |
| `get_schema` | Columns, allowed filter values, SQL vs search routing |
| `query_tickets` | Counts, group-bys, structured filters (read-only SQL) |
| `search_tickets` | Customer wording and themes (BM25 full-text search) |

Counts come from SQL execution, not from model memory. Search hits are ranked examples, not volume.

Dataset: [Tobi-Bueck/customer-support-tickets](https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets) (downloaded once at ingest).

Architecture and rejected alternatives: [DECISIONS.md](./DECISIONS.md). Delivery milestones: [LAYERS.md](./LAYERS.md).

## Requirements

- Node.js 20+
- npm
- An MCP host (Cursor, Claude Code, or Codex)

No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. The model is whatever the host already uses.

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

`data/` is gitignored. Each machine runs ingest locally.

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

You should see `get_schema`, `query_tickets`, and `search_tickets`.

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
| Password-reset complaints in German | `search_tickets` with `language: "de"` |

Optional MCP prompt: `ticket-analyst` (reminds the host: schema first, SQL for counts, search for wording).

Full list: [eval/questions.json](./eval/questions.json).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run ingest` | CSV → `data/tickets.duckdb` + FTS index |
| `npm run peek` | Print columns + sample rows from local DuckDB |
| `npm run build` | Compile `src/` → `dist/` |
| `npm start` | Run the stdio server |
| `npm run verify` | Smoke-test tools without a host |

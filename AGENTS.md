# Agent notes

Local MCP server: natural-language Q&A over a support-ticket dataset for analysts and ops.

## Architecture

- **Host** (Cursor, Claude Code, or Codex) plans tool calls.
- **This process** is the MCP server (stdio). It does not call an LLM.
- **Data** is a local DuckDB file produced by `npm run ingest` (Hugging Face is download-only, not a runtime dependency).

## Delivery milestones

See [LAYERS.md](./LAYERS.md).

## v1 constraints

- No server-side LLM
- No embeddings / RAG-only path
- Read-only tools
- No web UI
- No agent frameworks

## Decisions

[DECISIONS.md](./DECISIONS.md) is the source of truth for stack and tool choices.

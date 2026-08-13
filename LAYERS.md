# Delivery milestones

The server was delivered in verified increments. Each milestone is independently usable.

| # | Milestone | Outcome |
| --- | --- | --- |
| 0 | Product & architecture | Purpose, tool split, and store choice documented |
| 1 | MCP connectivity | Host can connect over stdio and call `ping` |
| 2 | Data ingest | `npm run ingest` builds local DuckDB (+ FTS index) |
| 3 | Schema tool | `get_schema` returns columns, types, and routing notes |
| 4 | SQL tool | `query_tickets` runs read-only SQL with guards |
| 5 | Search tools | `search_tickets` (examples + filters) and `search_metrics` (FTS match counts) |
| 6 | Operator docs & checks | README, MCP config, example questions, `npm run verify` |

**Current state:** milestones 0–6 complete. The one-page design document is a separate submission artifact (not required in this repository).

### Milestone notes

- [docs/LAYER1.md](./docs/LAYER1.md) — MCP + `ping`
- [docs/LAYER2.md](./docs/LAYER2.md) — ingest
- [docs/LAYER3.md](./docs/LAYER3.md) — `get_schema`
- [docs/LAYER4.md](./docs/LAYER4.md) — `query_tickets`
- [docs/LAYER5.md](./docs/LAYER5.md) — `search_tickets` / `search_metrics`
- [docs/LAYER6.md](./docs/LAYER6.md) — README / prompt / verify

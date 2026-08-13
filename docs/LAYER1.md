# Milestone 1 — Minimal MCP + `ping`

Goal: prove **Cursor → MCP client → our server → tool → back** works.

No DuckDB. No Hugging Face. One tool that returns `"pong"`.

---

## Files we added

### `package.json`

| Piece | Why |
| --- | --- |
| `"type": "module"` | MCP SDK uses ES modules (`import`) |
| `@modelcontextprotocol/sdk` | Implements MCP protocol — we don't hand-write JSON-RPC |
| `tsx` / `typescript` | Run and compile TypeScript |
| `"start": "node dist/index.js"` | What Cursor will spawn |

### `src/index.ts` — read top to bottom

1. **`McpServer`** — identity (`name`, `version`) sent during MCP handshake
2. **`registerTool("ping", ...)`** — advertises one capability to Cursor
   - `description` — Claude reads this to decide when to call the tool
   - `inputSchema: {}` — no arguments needed
   - handler — returns `{ content: [{ type: "text", text: "pong" }] }` (MCP result shape)
3. **`StdioServerTransport`** — listen on stdin, reply on stdout
4. **`server.connect(transport)`** — start the loop; process stays alive until Cursor closes it
5. **`console.error` in catch** — never log debug to stdout (would break MCP)

---

## Connect in Cursor

1. Build once:

   ```bash
   cd customer-support-analyst-mcp
   npm install
   npm run build
   ```

2. Add to **Cursor MCP settings** (user or project `.cursor/mcp.json`):

   ```json
   {
     "mcpServers": {
       "support-analyst": {
         "command": "node",
         "args": ["/ABSOLUTE/PATH/TO/customer-support-analyst-mcp/dist/index.js"]
       }
     }
   }
   ```

   Use your **absolute path**.

3. Restart MCP / reload Cursor. You should see `support-analyst` with a `ping` tool.

4. In chat, ask: **"Use the ping tool on the support-analyst MCP server"**

   Expected: Claude calls `ping` → you see `pong`.

---

## Verification

| Step | Meaning |
| --- | --- |
| Cursor spawns `node dist/index.js` | stdio transport works |
| Tool appears in list | `registerTool` + SDK handshake works |
| `ping` → `pong` | Full request/response loop works |

Milestone 2 adds ingest (CSV → DuckDB). Milestone 3+ add real tools.

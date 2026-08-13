import { executeReadOnlyQuery, MAX_SQL_ROWS } from "./query.js";
import { getTicketSchema } from "./schema.js";
import { searchTickets } from "./search.js";
import { validateReadOnlySql, wrapWithRowLimit } from "./sql-guard.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const schema = await getTicketSchema();
  assert(schema.table === "tickets", "schema.table should be tickets");
  assert(schema.row_count > 0, "schema.row_count should be > 0");
  console.log(`schema: ${schema.row_count} rows, ${schema.columns.length} columns`);

  const drop = validateReadOnlySql("DROP TABLE tickets");
  assert(!drop.ok, "DROP should be rejected by the SQL guard");

  const countGuard = validateReadOnlySql(
    "SELECT COUNT(*)::INTEGER AS n FROM tickets",
  );
  if (!countGuard.ok) {
    throw new Error(countGuard.error);
  }

  const countResult = await executeReadOnlyQuery(
    wrapWithRowLimit(countGuard.sql, MAX_SQL_ROWS),
  );
  const counted = Number(countResult.rows[0]?.n);
  assert(counted === schema.row_count, "COUNT(*) should match schema.row_count");
  console.log(`query_tickets COUNT(*): ${counted}`);

  const hits = await searchTickets({ query: "refund", k: 3 });
  assert(hits.length > 0, "search_tickets('refund') should return hits");
  console.log(`search_tickets refund hits: ${hits.length} (top id ${hits[0]?.ticket_id})`);

  console.log("verify ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

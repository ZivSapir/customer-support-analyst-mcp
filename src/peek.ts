import { all, DB_PATH, withReadOnlyConnection } from "./db.js";

const DEFAULT_LIMIT = 5;

function parseLimit(argv: string[]): number {
  const raw = argv[2];

  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid limit "${raw}". Use a positive integer.`);
  }

  return Math.min(parsed, 50);
}

async function main(): Promise<void> {
  const limit = parseLimit(process.argv);

  await withReadOnlyConnection(async (conn) => {
    console.log(`DuckDB: ${DB_PATH}\n`);

    const columns = await all<{
      column_name: string;
      column_type: string;
    }>(conn, "DESCRIBE tickets;");
    console.log("Columns");
    console.table(
      columns.map((column) => ({
        name: column.column_name,
        type: column.column_type,
      })),
    );

    const countRows = await all<{ n: number }>(
      conn,
      "SELECT COUNT(*)::INTEGER AS n FROM tickets;",
    );
    console.log(`\nRow count: ${countRows[0]?.n ?? 0}`);

    const sample = await all(
      conn,
      `
      SELECT
        ticket_id,
        subject,
        type,
        queue,
        priority,
        language
      FROM tickets
      ORDER BY ticket_id
      LIMIT ${limit};
      `,
    );
    console.log(`\nSample rows (limit ${limit})`);
    console.table(
      sample.map((row) => ({
        ...row,
        ticket_id:
          typeof row.ticket_id === "bigint"
            ? Number(row.ticket_id)
            : row.ticket_id,
      })),
    );
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

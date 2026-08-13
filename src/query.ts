import { all, withReadOnlyConnection } from "./db.js";

export const MAX_SQL_ROWS = 200;

export type QueryTicketsResult = {
  columns: string[];
  rowCount: number;
  truncated: boolean;
  rows: Record<string, unknown>[];
};

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  return value;
}

export async function executeReadOnlyQuery(
  sql: string,
): Promise<QueryTicketsResult> {
  return withReadOnlyConnection(async (conn) => {
    const rawRows = await all<Record<string, unknown>>(conn, sql);
    const rows = rawRows.map((row) => {
      const safeRow: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(row)) {
        safeRow[key] = toJsonSafe(value);
      }

      return safeRow;
    });

    return {
      columns: rows[0] ? Object.keys(rows[0]) : [],
      rowCount: rows.length,
      truncated: rows.length >= MAX_SQL_ROWS,
      rows,
    };
  });
}

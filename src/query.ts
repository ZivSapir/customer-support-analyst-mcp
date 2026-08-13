import { all, withReadOnlyConnection } from "./db.js";

export const MAX_SQL_ROWS = 200;

export type QueryTicketsResult = {
  columns: string[];
  /** Number of rows returned in this payload (not the full query cardinality). */
  returnedRowCount: number;
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
    const safeRows = rawRows.map((row) => {
      const safeRow: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(row)) {
        safeRow[key] = toJsonSafe(value);
      }

      return safeRow;
    });

    // Caller wraps with LIMIT max+1 so we can tell "exactly max" from "more than max".
    const truncated = safeRows.length > MAX_SQL_ROWS;
    const rows = truncated ? safeRows.slice(0, MAX_SQL_ROWS) : safeRows;

    return {
      columns: rows[0] ? Object.keys(rows[0]) : [],
      returnedRowCount: rows.length,
      truncated,
      rows,
    };
  });
}

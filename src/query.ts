import { all, withReadOnlyConnection } from "./db.js";

export const MAX_SQL_ROWS = 200;
/** Cap each string cell so one fat column cannot blow the host context. */
export const MAX_FIELD_CHARS = 2_000;
/** Cap serialized JSON size for the tool result (approx UTF-8 byte length). */
export const MAX_RESULT_BYTES = 100_000;

const FIELD_TRUNCATE_SUFFIX = "…[truncated]";

export type TruncationReason = "rows" | "fields" | "payload";

export type QueryTicketsResult = {
  columns: string[];
  /** Number of rows returned in this payload (not the full query cardinality). */
  returnedRowCount: number;
  /** True if rows, fields, or total payload were cut. */
  truncated: boolean;
  truncationReasons: TruncationReason[];
  rows: Record<string, unknown>[];
};

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  return value;
}

function truncateField(
  value: unknown,
): { value: unknown; truncated: boolean } {
  const safe = toJsonSafe(value);

  if (typeof safe !== "string") {
    return { value: safe, truncated: false };
  }

  if (safe.length <= MAX_FIELD_CHARS) {
    return { value: safe, truncated: false };
  }

  const keep = Math.max(0, MAX_FIELD_CHARS - FIELD_TRUNCATE_SUFFIX.length);
  return {
    value: `${safe.slice(0, keep)}${FIELD_TRUNCATE_SUFFIX}`,
    truncated: true,
  };
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function serializeResult(result: QueryTicketsResult): string {
  return JSON.stringify(result, null, 2);
}

export async function executeReadOnlyQuery(
  sql: string,
): Promise<QueryTicketsResult> {
  return withReadOnlyConnection(async (conn) => {
    const rawRows = await all<Record<string, unknown>>(conn, sql);

    const reasons = new Set<TruncationReason>();
    let fieldsTruncated = false;

    const safeRows = rawRows.map((row) => {
      const safeRow: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(row)) {
        const truncated = truncateField(value);
        safeRow[key] = truncated.value;
        if (truncated.truncated) {
          fieldsTruncated = true;
        }
      }

      return safeRow;
    });

    if (fieldsTruncated) {
      reasons.add("fields");
    }

    // Caller wraps with LIMIT max+1 so we can tell "exactly max" from "more than max".
    if (safeRows.length > MAX_SQL_ROWS) {
      reasons.add("rows");
    }
    let rows = reasons.has("rows")
      ? safeRows.slice(0, MAX_SQL_ROWS)
      : safeRows;

    const build = (nextRows: Record<string, unknown>[]): QueryTicketsResult => {
      const truncationReasons = [...reasons];
      return {
        columns: nextRows[0] ? Object.keys(nextRows[0]) : [],
        returnedRowCount: nextRows.length,
        truncated: truncationReasons.length > 0,
        truncationReasons,
        rows: nextRows,
      };
    };

    let result = build(rows);

    while (
      rows.length > 0 &&
      utf8Bytes(serializeResult(result)) > MAX_RESULT_BYTES
    ) {
      reasons.add("payload");
      // Drop from the end until under budget (keep at least one row if possible).
      if (rows.length === 1) {
        // Last resort: blank oversized fields further on the single remaining row.
        const only = { ...rows[0] };
        for (const [key, value] of Object.entries(only)) {
          if (typeof value === "string" && value.length > 200) {
            only[key] = `${value.slice(0, 200)}${FIELD_TRUNCATE_SUFFIX}`;
            reasons.add("fields");
          }
        }
        rows = [only];
        result = build(rows);
        if (utf8Bytes(serializeResult(result)) > MAX_RESULT_BYTES) {
          rows = [];
          result = build(rows);
        }
        break;
      }

      rows = rows.slice(0, -1);
      result = build(rows);
    }

    return result;
  });
}

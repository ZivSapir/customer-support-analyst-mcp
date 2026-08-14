import { withReadOnlyConnection } from "./db.js";

export type SqlGuardResult =
  | { ok: true; sql: string }
  | { ok: false; error: string };

const FORBIDDEN_KEYWORDS = [
  "alter",
  "attach",
  "begin",
  "call",
  "checkpoint",
  "commit",
  "copy",
  "create",
  "delete",
  "detach",
  "drop",
  "execute",
  "export",
  "grant",
  "import",
  "insert",
  "install",
  "load",
  "merge",
  "pragma",
  "prepare",
  "replace",
  "reset",
  "revoke",
  "rollback",
  "set",
  "truncate",
  "update",
  "vacuum",
] as const;

function stripComments(sql: string): string {
  const withoutBlock = sql.replace(/\/\*[\s\S]*?\*\//g, " ");

  if (withoutBlock.includes("/*")) {
    throw new Error("Unterminated block comment.");
  }

  return withoutBlock.replace(/--[^\n]*/g, " ");
}

function stripStringLiterals(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
}

function normalize(sql: string): string {
  return sql.trim().replace(/;+\s*$/g, "").trim();
}

export async function validateReadOnlySql(
  rawSql: string,
): Promise<SqlGuardResult> {
  const sql = normalize(rawSql);

  if (sql.length === 0) {
    return { ok: false, error: "SQL query is empty." };
  }

  let stripped: string;

  try {
    stripped = stripComments(stripStringLiterals(sql));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }

  try {
    const statementCount = await withReadOnlyConnection(async (conn) => {
      const statements = await conn.extractStatements(sql);
      return statements.count;
    });

    if (statementCount !== 1) {
      return {
        ok: false,
        error: "Only a single SQL statement is allowed.",
      };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Invalid SQL: ${message}` };
  }

  if (!/^(select|with)\b/i.test(stripped.trim())) {
    return {
      ok: false,
      error: "Only SELECT or WITH (CTE) queries are allowed.",
    };
  }

  const lower = stripped.toLowerCase();

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");

    if (pattern.test(lower)) {
      return {
        ok: false,
        error: `Forbidden keyword in SQL: ${keyword.toUpperCase()}. This tool is read-only.`,
      };
    }
  }

  return { ok: true, sql };
}

export function wrapWithRowLimit(sql: string, maxRows: number): string {
  // Fetch one extra row so executeReadOnlyQuery can set truncated accurately
  // when the true result size is exactly maxRows.
  return `SELECT * FROM (\n${sql}\n) AS _query_tickets LIMIT ${maxRows + 1}`;
}

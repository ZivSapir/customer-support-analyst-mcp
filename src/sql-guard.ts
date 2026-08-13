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

export function validateReadOnlySql(rawSql: string): SqlGuardResult {
  const sql = normalize(rawSql);

  if (sql.length === 0) {
    return { ok: false, error: "SQL query is empty." };
  }

  let stripped: string;

  try {
    stripped = stripStringLiterals(stripComments(sql));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }

  if (stripped.includes(";")) {
    return {
      ok: false,
      error: "Only a single SQL statement is allowed.",
    };
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
  return `SELECT * FROM (\n${sql}\n) AS _query_tickets LIMIT ${maxRows}`;
}

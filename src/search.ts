import { all, run, withReadOnlyConnection } from "./db.js";

export const DEFAULT_SEARCH_K = 5;
export const MAX_SEARCH_K = 20;
const BODY_PREVIEW_CHARS = 400;

export const SEARCH_FILTER_COLUMNS = [
  "type",
  "queue",
  "priority",
  "language",
] as const;

export type SearchFilterColumn = (typeof SEARCH_FILTER_COLUMNS)[number];

export type SearchTicketsFilters = {
  language?: string;
  priority?: string;
  queue?: string;
  type?: string;
};

export type SearchTicketsInput = SearchTicketsFilters & {
  query: string;
  k?: number;
};

export type SearchTicketHit = {
  ticket_id: number;
  score: number;
  subject: string;
  body_preview: string;
  language: string;
  queue: string;
  priority: string;
};

export type SearchMetricsInput = SearchTicketsFilters & {
  query: string;
  group_by?: SearchFilterColumn;
};

export type SearchMetricsResult = {
  query: string;
  semantics: string;
  filters: SearchTicketsFilters;
  group_by: SearchFilterColumn | null;
  match_count: number;
  groups: Array<{ value: string; match_count: number }>;
};

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function toJsonSafeNumber(value: unknown): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  return Number(value);
}

function buildStructuredFilters(filters: SearchTicketsFilters): string {
  const clauses: string[] = [];

  for (const column of SEARCH_FILTER_COLUMNS) {
    const value = filters[column];
    if (value === undefined) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }

    clauses.push(`${column} = '${escapeSqlString(trimmed)}'`);
  }

  if (clauses.length === 0) {
    return "";
  }

  return `AND ${clauses.join(" AND ")}`;
}

function assertNonEmptyQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("Search query is empty.");
  }
  return trimmed;
}

export async function searchTickets(
  input: SearchTicketsInput,
): Promise<SearchTicketHit[]> {
  const query = assertNonEmptyQuery(input.query);
  const k = Math.min(Math.max(input.k ?? DEFAULT_SEARCH_K, 1), MAX_SEARCH_K);
  const escapedQuery = escapeSqlString(query);
  const structuredFilters = buildStructuredFilters(input);

  return withReadOnlyConnection(
    async (conn) => {
      await run(conn, "LOAD fts;");

      const rows = await all<{
        ticket_id: number | bigint;
        score: number;
        subject: string;
        body_preview: string;
        language: string;
        queue: string;
        priority: string;
      }>(
        conn,
        `
      SELECT
        ticket_id,
        score,
        subject,
        body_preview,
        language,
        queue,
        priority
      FROM (
        SELECT
          ticket_id,
          subject,
          left(coalesce(body, ''), ${BODY_PREVIEW_CHARS}) AS body_preview,
          language,
          queue,
          priority,
          fts_main_tickets.match_bm25(ticket_id, '${escapedQuery}') AS score
        FROM tickets
      ) ranked
      WHERE score IS NOT NULL
      ${structuredFilters}
      ORDER BY score DESC
      LIMIT ${k};
      `,
      );

      return rows.map((row) => ({
        ticket_id: toJsonSafeNumber(row.ticket_id),
        score: toJsonSafeNumber(row.score),
        subject: String(row.subject ?? ""),
        body_preview: String(row.body_preview ?? ""),
        language: String(row.language ?? ""),
        queue: String(row.queue ?? ""),
        priority: String(row.priority ?? ""),
      }));
    },
    { enableExternalAccess: true },
  );
}

export async function searchMetrics(
  input: SearchMetricsInput,
): Promise<SearchMetricsResult> {
  const query = assertNonEmptyQuery(input.query);
  const escapedQuery = escapeSqlString(query);
  const structuredFilters = buildStructuredFilters(input);
  const filters: SearchTicketsFilters = {
    language: input.language,
    priority: input.priority,
    queue: input.queue,
    type: input.type,
  };

  const semantics =
    "Lexical BM25 FTS match count over subject/body — not a semantic label of all related tickets.";

  return withReadOnlyConnection(
    async (conn) => {
      await run(conn, "LOAD fts;");

      const matchedCte = `
      WITH matched AS (
        SELECT
          ticket_id,
          type,
          queue,
          priority,
          language,
          fts_main_tickets.match_bm25(ticket_id, '${escapedQuery}') AS score
        FROM tickets
      )
      `;

      if (input.group_by === undefined) {
        const rows = await all<{ match_count: number | bigint }>(
          conn,
          `
          ${matchedCte}
          SELECT COUNT(*)::INTEGER AS match_count
          FROM matched
          WHERE score IS NOT NULL
          ${structuredFilters};
          `,
        );

        return {
          query,
          semantics,
          filters,
          group_by: null,
          match_count: toJsonSafeNumber(rows[0]?.match_count ?? 0),
          groups: [],
        };
      }

      const groupBy = input.group_by;
      const rows = await all<{
        value: string;
        match_count: number | bigint;
      }>(
        conn,
        `
        ${matchedCte}
        SELECT
          CAST(${groupBy} AS VARCHAR) AS value,
          COUNT(*)::INTEGER AS match_count
        FROM matched
        WHERE score IS NOT NULL
        ${structuredFilters}
        GROUP BY ${groupBy}
        ORDER BY match_count DESC, value;
        `,
      );

      const groups = rows.map((row) => ({
        value: String(row.value ?? ""),
        match_count: toJsonSafeNumber(row.match_count),
      }));

      return {
        query,
        semantics,
        filters,
        group_by: groupBy,
        match_count: groups.reduce((sum, row) => sum + row.match_count, 0),
        groups,
      };
    },
    { enableExternalAccess: true },
  );
}

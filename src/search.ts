import {
  all,
  isSharedDatabaseOpen,
  run,
  withReadOnlyConnection,
  type DuckDBConnection,
} from "./db.js";

export const DEFAULT_SEARCH_K = 5;
export const MAX_SEARCH_K = 20;

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
  relevance_score: number;
  subject: string;
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

type BoundFilters = {
  sql: string;
  values: string[];
};

function toJsonSafeNumber(value: unknown): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  return Number(value);
}

function buildStructuredFilters(filters: SearchTicketsFilters): BoundFilters {
  const clauses: string[] = [];
  const values: string[] = [];

  for (const column of SEARCH_FILTER_COLUMNS) {
    const value = filters[column];
    if (value === undefined) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }

    // Parameter indexes are assigned by the caller after the FTS query ($1).
    clauses.push(`${column} = $${clauses.length + 2}`);
    values.push(trimmed);
  }

  if (clauses.length === 0) {
    return { sql: "", values: [] };
  }

  return {
    sql: `AND ${clauses.join(" AND ")}`,
    values,
  };
}

function assertNonEmptyQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("Search query is empty.");
  }
  return trimmed;
}

async function withFtsConnection<T>(
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  return withReadOnlyConnection(async (conn) => {
    if (!isSharedDatabaseOpen()) {
      // CLI paths (verify) open an ephemeral connection — load FTS each time.
      await run(conn, "LOAD fts;");
    }
    return fn(conn);
  }, { enableExternalAccess: true });
}

export async function searchTickets(
  input: SearchTicketsInput,
): Promise<SearchTicketHit[]> {
  const query = assertNonEmptyQuery(input.query);
  const k = Math.min(Math.max(input.k ?? DEFAULT_SEARCH_K, 1), MAX_SEARCH_K);
  const structuredFilters = buildStructuredFilters(input);
  const limitParamIndex = structuredFilters.values.length + 2;

  return withFtsConnection(async (conn) => {
    const rows = await all<{
      ticket_id: number | bigint;
      relevance_score: number;
      subject: string;
      language: string;
      queue: string;
      priority: string;
    }>(
      conn,
      `
      SELECT
        ticket_id,
        relevance_score,
        subject,
        language,
        queue,
        priority
      FROM (
        SELECT
          ticket_id,
          subject,
          language,
          queue,
          priority,
          fts_main_tickets.match_bm25(ticket_id, $1) AS relevance_score
        FROM tickets
      ) ranked
      WHERE relevance_score IS NOT NULL
      ${structuredFilters.sql}
      ORDER BY relevance_score DESC
      LIMIT $${limitParamIndex};
      `,
      [query, ...structuredFilters.values, k],
    );

    return rows.map((row) => ({
      ticket_id: toJsonSafeNumber(row.ticket_id),
      relevance_score: toJsonSafeNumber(row.relevance_score),
      subject: String(row.subject ?? ""),
      language: String(row.language ?? ""),
      queue: String(row.queue ?? ""),
      priority: String(row.priority ?? ""),
    }));
  });
}

export async function searchMetrics(
  input: SearchMetricsInput,
): Promise<SearchMetricsResult> {
  const query = assertNonEmptyQuery(input.query);
  const structuredFilters = buildStructuredFilters(input);
  const filters: SearchTicketsFilters = {
    language: input.language,
    priority: input.priority,
    queue: input.queue,
    type: input.type,
  };

  const semantics =
    "Lexical BM25 FTS match count over subject/body — ranking score is for ordering only; match_count is lexical volume, not a semantic label.";

  return withFtsConnection(async (conn) => {
    const matchedCte = `
      WITH matched AS (
        SELECT
          ticket_id,
          type,
          queue,
          priority,
          language,
          fts_main_tickets.match_bm25(ticket_id, $1) AS relevance_score
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
          WHERE relevance_score IS NOT NULL
          ${structuredFilters.sql};
          `,
        [query, ...structuredFilters.values],
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
        WHERE relevance_score IS NOT NULL
        ${structuredFilters.sql}
        GROUP BY ${groupBy}
        ORDER BY match_count DESC, value;
        `,
      [query, ...structuredFilters.values],
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
  });
}

import {
  all,
  isSharedDatabaseOpen,
  run,
  withReadOnlyConnection,
  type DuckDBConnection,
} from "./db.js";
import { MAX_FIELD_CHARS } from "./query.js";

export const DEFAULT_SEARCH_K = 5;
export const MAX_SEARCH_K = 20;

export const SEARCH_FILTER_COLUMNS = [
  "type",
  "queue",
  "priority",
  "language",
] as const;

export const SEARCH_MATCH_MODES = ["any", "all"] as const;

export type SearchFilterColumn = (typeof SEARCH_FILTER_COLUMNS)[number];
export type SearchMatchMode = (typeof SEARCH_MATCH_MODES)[number];

export const DEFAULT_SEARCH_MATCH_MODE: SearchMatchMode = "any";

export type SearchTicketsFilters = {
  language?: string;
  priority?: string;
  queue?: string;
  type?: string;
};

export type SearchTicketsInput = SearchTicketsFilters & {
  query: string;
  k?: number;
  match_mode?: SearchMatchMode;
};

export type SearchTicketHit = {
  ticket_id: number;
  relevance_score: number;
  subject: string;
  type: string;
  language: string;
  queue: string;
  priority: string;
};

export type SearchMetricsInput = SearchTicketsFilters & {
  query: string;
  group_by?: SearchFilterColumn;
  match_mode?: SearchMatchMode;
};

export type SearchMetricsResult = {
  query: string;
  match_mode: SearchMatchMode;
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

type NormalizedSearchFilters = {
  applied: SearchTicketsFilters;
  bound: BoundFilters;
};

const SUBJECT_TRUNCATE_SUFFIX = "…[truncated]";

function truncateSubject(subject: string): string {
  if (subject.length <= MAX_FIELD_CHARS) {
    return subject;
  }

  const keep = Math.max(0, MAX_FIELD_CHARS - SUBJECT_TRUNCATE_SUFFIX.length);
  return `${subject.slice(0, keep)}${SUBJECT_TRUNCATE_SUFFIX}`;
}

function normalizeSearchFilters(
  filters: SearchTicketsFilters,
): NormalizedSearchFilters {
  const applied: SearchTicketsFilters = {};
  const clauses: string[] = [];
  const values: string[] = [];

  for (const column of SEARCH_FILTER_COLUMNS) {
    const value = filters[column];
    if (value === undefined) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(
        `Filter "${column}" is empty. Omit the filter or supply a value from get_schema.`,
      );
    }

    applied[column] = trimmed;
    clauses.push(`${column} = $${clauses.length + 2}`);
    values.push(trimmed);
  }

  if (clauses.length === 0) {
    return { applied, bound: { sql: "", values: [] } };
  }

  return {
    applied,
    bound: {
      sql: `AND ${clauses.join(" AND ")}`,
      values,
    },
  };
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

function assertNonEmptyQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("Search query is empty.");
  }
  return trimmed;
}

function resolveMatchMode(matchMode: SearchMatchMode | undefined): SearchMatchMode {
  return matchMode ?? DEFAULT_SEARCH_MATCH_MODE;
}

/** DuckDB FTS: conjunctive 0 = any term; 1 = all terms (not phrase match). */
function matchBm25Sql(matchMode: SearchMatchMode): string {
  const conjunctive = matchMode === "all" ? 1 : 0;
  return `fts_main_tickets.match_bm25(ticket_id, $1, conjunctive := ${conjunctive})`;
}

function matchModeSemantics(matchMode: SearchMatchMode): string {
  const termRule =
    matchMode === "all"
      ? "match_mode=all requires every query term (after stemming/stopwords)"
      : "match_mode=any (default) matches if any query term occurs";
  return `Lexical BM25 FTS match count over subject/body — ${termRule}; neither mode is exact phrase matching. Ranking score is for ordering only; match_count is lexical volume, not a semantic label.`;
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
  const matchMode = resolveMatchMode(input.match_mode);
  const k = Math.min(Math.max(input.k ?? DEFAULT_SEARCH_K, 1), MAX_SEARCH_K);
  const { bound: structuredFilters } = normalizeSearchFilters(input);
  const limitParamIndex = structuredFilters.values.length + 2;

  return withFtsConnection(async (conn) => {
    const rows = await all<{
      ticket_id: number | bigint;
      relevance_score: number;
      subject: string;
      type: string;
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
        type,
        language,
        queue,
        priority
      FROM (
        SELECT
          ticket_id,
          subject,
          type,
          language,
          queue,
          priority,
          ${matchBm25Sql(matchMode)} AS relevance_score
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
      subject: truncateSubject(String(row.subject ?? "")),
      type: String(row.type ?? ""),
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
  const matchMode = resolveMatchMode(input.match_mode);
  const { applied: filters, bound: structuredFilters } =
    normalizeSearchFilters(input);

  const semantics = matchModeSemantics(matchMode);

  return withFtsConnection(async (conn) => {
    const matchedCte = `
      WITH matched AS (
        SELECT
          ticket_id,
          type,
          queue,
          priority,
          language,
          ${matchBm25Sql(matchMode)} AS relevance_score
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
        match_mode: matchMode,
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
      match_mode: matchMode,
      semantics,
      filters,
      group_by: groupBy,
      match_count: groups.reduce((sum, row) => sum + row.match_count, 0),
      groups,
    };
  });
}

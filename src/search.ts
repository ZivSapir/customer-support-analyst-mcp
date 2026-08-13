import { all, run, withReadOnlyConnection } from "./db.js";

export const DEFAULT_SEARCH_K = 5;
export const MAX_SEARCH_K = 20;
const BODY_PREVIEW_CHARS = 400;

export type SearchTicketsInput = {
  query: string;
  k?: number;
  language?: "en" | "de";
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

export async function searchTickets(
  input: SearchTicketsInput,
): Promise<SearchTicketHit[]> {
  const query = input.query.trim();

  if (query.length === 0) {
    throw new Error("Search query is empty.");
  }

  const k = Math.min(Math.max(input.k ?? DEFAULT_SEARCH_K, 1), MAX_SEARCH_K);
  const escapedQuery = escapeSqlString(query);
  const languageFilter =
    input.language === undefined
      ? ""
      : `AND language = '${escapeSqlString(input.language)}'`;

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
      ${languageFilter}
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

import { executeReadOnlyQuery } from "./query.js";
import { TICKET_DATA_ENVELOPE } from "./trust.js";

export { TICKET_DATA_ENVELOPE };
export type GetTicketResult = {
  ticket_id: number;
  found: boolean;
  data_envelope: string;
  truncated: boolean;
  truncationReasons: string[];
  ticket: Record<string, unknown> | null;
};

export async function getTicket(ticketId: number): Promise<GetTicketResult> {
  if (!Number.isInteger(ticketId) || ticketId < 1) {
    throw new Error("ticket_id must be a positive integer.");
  }

  const result = await executeReadOnlyQuery(
    `SELECT * FROM tickets WHERE ticket_id = ${ticketId}`,
    { maxRows: 1 },
  );

  if (result.rows.length === 0) {
    return {
      ticket_id: ticketId,
      found: false,
      data_envelope: TICKET_DATA_ENVELOPE,
      truncated: false,
      truncationReasons: [],
      ticket: null,
    };
  }

  return {
    ticket_id: ticketId,
    found: true,
    data_envelope: TICKET_DATA_ENVELOPE,
    truncated: result.truncated,
    truncationReasons: result.truncationReasons,
    ticket: result.rows[0] ?? null,
  };
}

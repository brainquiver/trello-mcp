import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// A date as Trello takes it: an ISO 8601 date, with a time or without.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

// Checked before any request. Another form can be ambiguous: 01/10/2026 is 1 October in the
// UK and 10 January in the US.
export function checkDates(dates: Record<string, string | null | undefined>): void {
  for (const [field, value] of Object.entries(dates)) {
    if (typeof value === 'string' && !isIsoDate(value)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `${field} "${value}" is not an ISO 8601 date, as 2026-10-01 or 2026-10-01T12:00:00Z. Nothing was sent to Trello.`
      );
    }
  }
}

// The house limit for a card description, from the board-card rules. Trello itself allows
// more. TRELLO_DESCRIPTION_LIMIT overrides it.
export const DEFAULT_DESCRIPTION_LIMIT = 2400;

// Characters as a reader counts them, so an emoji or an accented letter counts once.
export function descriptionLength(description: string | undefined): number {
  return description === undefined ? 0 : [...description].length;
}

// Checked before any request, so an overlong description never reaches Trello.
export function checkDescription(description: string | undefined, limit: number): void {
  const length = descriptionLength(description);
  if (length > limit) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Description is ${length} characters, ${length - limit} over the ${limit} limit. Shorten it and send it again. Nothing was sent to Trello.`
    );
  }
}

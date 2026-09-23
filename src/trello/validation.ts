import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// A date as Trello takes it: an ISO 8601 date, with a time or without.
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

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

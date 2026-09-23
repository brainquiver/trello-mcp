import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import * as shape from '../reply/shape.js';
import { formatCardAsMarkdown } from '../reply/markdown.js';
import { formatCardListResponse } from '../reply/card-list.js';
import { json, safe } from '../reply/respond.js';

/** The card tools: finding, reading, creating, changing and archiving cards. */
export function registerCardTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'get_cards_by_list_id',
    {
      title: 'Get Cards by List ID',
      description:
        'Fetch cards from a specific Trello list on a specific board. Descriptions are previewed by default to keep responses compact; set fields without "desc" to omit descriptions, or increase descMaxLength/omitDescThresholdBytes and use get_card for full details.',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe('Board the list is on. If given, a list on any other board is refused'),
        listId: z.string().describe('ID of the Trello list'),
        fields: z
          .string()
          .optional()
          .describe(
            'Comma-separated list of fields to return (e.g., "name,idShort,labels,due,dueComplete"). Omit for all fields.'
          ),
        nameFilter: z
          .string()
          .trim()
          .min(1, 'nameFilter must not be empty')
          .optional()
          .describe('Optional substring to filter cards by name (case-insensitive)'),
        descMaxLength: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Maximum description preview length per card. Defaults to 200. Increase for fuller descriptions.'
          ),
        omitDescThresholdBytes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Approximate response size threshold before descriptions are omitted. Defaults to 50000 bytes.'
          ),
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ boardId, listId, fields, nameFilter, descMaxLength, omitDescThresholdBytes, raw }) =>
      safe(async () => {
        const cards = await client.getCardsByList(listId, fields, nameFilter, boardId);
        const options = { descMaxLength, omitDescThresholdBytes };
        return raw
          ? formatCardListResponse(cards, options)
          : formatCardListResponse(cards.map(shape.card), options);
      })
  );

  server.registerTool(
    'get_my_cards',
    {
      title: 'Get My Cards',
      description: 'Fetch all cards assigned to the current user',
      inputSchema: {
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ raw }) => json(() => client.getMyCards(), raw ? undefined : shape.many(shape.card))
  );

  server.registerTool(
    'search_cards',
    {
      title: 'Search Cards',
      description:
        'Search card names and descriptions by text, on one board or on every board the user can reach. Returns the name, number, board, list and link of each match.',
      inputSchema: {
        query: z.string().describe('Text to search for. A word matches as a prefix'),
        boardId: z
          .string()
          .optional()
          .describe('Search this board only (searches every allowed board if not provided)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe('Most matches to return (default 20, at most 100)'),
      },
    },
    async ({ query, boardId, limit }) =>
      json(() => client.searchCards(query, boardId, limit), shape.many(shape.card))
  );

  server.registerTool(
    'get_card',
    {
      title: 'Get Card',
      description:
        'Get detailed information about a card, by its ID or by its number on a board. The number is the one Trello shows on the card and a branch name carries, as 53 in fix/53-chat-button.',
      inputSchema: {
        cardId: z.string().optional().describe('ID of the card. Give this or cardNumber'),
        cardNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Number of the card on its board. Give this or cardId'),
        boardId: z
          .string()
          .optional()
          .describe(
            'Board the card is on. Needed with cardNumber when there is no active board. With cardId, a card on any other board is refused'
          ),
        includeMarkdown: z
          .boolean()
          .optional()
          .default(false)
          .describe('Whether to return card description in markdown format (default: false)'),
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ cardId, cardNumber, boardId, includeMarkdown, raw }) =>
      json(
        async () => client.getCard(await client.resolveCardId(cardId, cardNumber, boardId)),
        // Markdown wins over raw, because it is the more specific request.
        includeMarkdown ? formatCardAsMarkdown : raw ? undefined : shape.card
      )
  );

  server.registerTool(
    'get_card_history',
    {
      title: 'Get Card History',
      description: 'Get the history/actions of a specific card',
      inputSchema: {
        cardId: z.string().describe('ID of the card to get history for'),
        filter: z
          .string()
          .optional()
          .describe(
            'Optional: Filter actions by type (e.g., "all", "updateCard:idList", "addAttachmentToCard", "commentCard", "updateCard:name", "updateCard:desc", "updateCard:due", "addMemberToCard", "removeMemberFromCard", "addLabelToCard", "removeLabelFromCard")'
          ),
        limit: z
          .number()
          .optional()
          .describe('Optional: Number of actions to fetch (default: all)'),
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ cardId, filter, limit, raw }) =>
      json(
        () => client.getCardHistory(cardId, filter, limit),
        raw ? undefined : shape.many(shape.action)
      )
  );

  server.registerTool(
    'add_card_to_list',
    {
      title: 'Add Card to List',
      description: 'Add a new card to a specified list on a specific board',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe('Board the list is on. If given, a list on any other board is refused'),
        listId: z.string().describe('ID of the list to add the card to'),
        name: z.string().describe('Name of the card'),
        description: z
          .string()
          .optional()
          .describe(`Description of the card, ${client.descriptionLimit} characters at most`),
        dueDate: z.string().optional().describe('Due date for the card (ISO 8601 format)'),
        dueReminder: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(
            'Due date reminder in minutes before due date (e.g., null to remove reminder, 0 at due time, 1440 one day before)'
          ),
        start: z
          .string()
          .optional()
          .describe('Start date for the card (YYYY-MM-DD format, date only)'),
        labels: z.array(z.string()).optional().describe('Array of label IDs to apply to the card'),
      },
    },
    async args => json(() => client.addCard(args.boardId, args), shape.card)
  );

  server.registerTool(
    'add_cards_to_list',
    {
      title: 'Add Cards to List',
      description: `Add up to 50 cards to a list, in order. Every card is checked first (the list exists, each label is on the board, each date is valid, each description is ${client.descriptionLimit} characters at most), so bad input creates nothing. A temporary Trello or network fault is retried. Any other failure stops the batch, and the reply says which cards were created and which were not: ask the user how to resolve it before retrying.`,
      inputSchema: {
        listId: z.string().describe('ID of the list to add cards to'),
        cards: z
          .array(
            z.object({
              name: z.string().describe('Name of the card'),
              description: z
                .string()
                .optional()
                .describe(`Description of the card, ${client.descriptionLimit} characters at most`),
              dueDate: z.string().optional().describe('Due date for the card (ISO 8601 format)'),
              start: z.string().optional().describe('Start date for the card (YYYY-MM-DD format)'),
              labels: z
                .array(z.string())
                .optional()
                .describe('Array of label IDs to apply to the card'),
            })
          )
          .describe('Array of cards to create (max 50)'),
      },
    },
    async ({ listId, cards }) =>
      safe(async () => {
        const result = await client.batchAddCards(listId, cards);
        const text = JSON.stringify({ ...result, created: result.created.map(shape.card) });
        if (!result.stopped) return { content: [{ type: 'text' as const, text }] };
        return {
          content: [{ type: 'text' as const, text: `${result.stopped.message}\n\n${text}` }],
          isError: true,
        };
      })
  );

  server.registerTool(
    'update_card_details',
    {
      title: 'Update Card Details',
      description:
        "Update an existing card's details. Name the card by its ID or by its number on a board.",
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe(
            'Board the card is on. Needed with cardNumber when there is no active board. With cardId, a card on any other board is refused'
          ),
        cardNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Number of the card on its board. Give this or cardId'),
        cardId: z.string().optional().describe('ID of the card to update. Give this or cardNumber'),
        name: z.string().optional().describe('New name for the card'),
        description: z
          .string()
          .optional()
          .describe(`New description for the card, ${client.descriptionLimit} characters at most`),
        dueDate: z.string().optional().describe('New due date for the card (ISO 8601 format)'),
        dueReminder: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(
            'New due date reminder in minutes before due date (e.g., null to remove reminder, 0 at due time, 1440 one day before)'
          ),
        start: z
          .string()
          .optional()
          .describe('New start date for the card (YYYY-MM-DD format, date only)'),
        dueComplete: z
          .boolean()
          .optional()
          .describe('Mark the due date as complete (true) or incomplete (false)'),
        labels: z.array(z.string()).optional().describe('New array of label IDs for the card'),
        pos: z
          .union([z.string(), z.number()])
          .optional()
          .describe(
            'Position of the card in the list. Accepts "top", "bottom", or a positive number'
          ),
      },
    },
    async args => json(() => client.updateCard(args.boardId, args), shape.card)
  );

  server.registerTool(
    'move_card',
    {
      title: 'Move Card',
      description: 'Move a card to a different list, potentially on a different board',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe(
            'Board the target list is on. If given, a list on any other board is refused. The card always moves to the board of listId'
          ),
        cardId: z.string().describe('ID of the card to move'),
        listId: z.string().describe('ID of the target list'),
        pos: z
          .union([z.string(), z.number()])
          .optional()
          .describe(
            'Position of the card in the target list. Accepts "top", "bottom", or a positive number'
          ),
      },
    },
    async ({ boardId, cardId, listId, pos }) =>
      json(() => client.moveCard(boardId, cardId, listId, pos), shape.card)
  );

  server.registerTool(
    'copy_card',
    {
      title: 'Copy Card',
      description:
        'Copy/duplicate a Trello card to any list (even on a different board). Copies all properties by default including checklists, attachments, comments, labels, etc.',
      inputSchema: {
        sourceCardId: z.string().describe('ID of the source card to copy'),
        listId: z.string().describe('ID of the destination list (can be on a different board)'),
        name: z
          .string()
          .optional()
          .describe('Override the name of the copied card (defaults to source card name)'),
        description: z.string().optional().describe('Override the description of the copied card'),
        keepFromSource: z
          .string()
          .optional()
          .describe(
            'Comma-separated list of properties to copy: "all" (default), or any combination of: attachments, checklists, comments, customFields, due, start, labels, members, stickers'
          ),
        pos: z
          .string()
          .optional()
          .describe('Position of the new card: "top", "bottom", or a positive float'),
      },
    },
    async ({ sourceCardId, listId, name, description, keepFromSource, pos }) =>
      json(
        () => client.copyCard({ sourceCardId, listId, name, description, keepFromSource, pos }),
        shape.card
      )
  );

  server.registerTool(
    'archive_card',
    {
      title: 'Archive Card',
      description:
        'Send a card to the archive. Name the card by its ID or by its number on a board.',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe(
            'Board the card is on. Needed with cardNumber when there is no active board. With cardId, a card on any other board is refused'
          ),
        cardNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Number of the card on its board. Give this or cardId'),
        cardId: z
          .string()
          .optional()
          .describe('ID of the card to archive. Give this or cardNumber'),
      },
    },
    async ({ boardId, cardId, cardNumber }) =>
      json(() => client.archiveCard(boardId, cardId, cardNumber), shape.card)
  );

  server.registerTool(
    'watch_card',
    {
      title: 'Watch Card',
      description: 'Subscribe or unsubscribe from watching a card for activity notifications',
      inputSchema: {
        cardId: z.string().describe('ID of the card to watch/unwatch'),
        subscribed: z.boolean().describe('Set to true to start watching, false to stop'),
      },
    },
    async ({ cardId, subscribed }) => json(() => client.watchCard(cardId, subscribed), shape.card)
  );
}

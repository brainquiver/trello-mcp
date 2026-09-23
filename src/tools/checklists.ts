import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import * as shape from '../reply/shape.js';
import { json, safe } from '../reply/respond.js';

/** The checklist tools, acceptance criteria included. */
export function registerChecklistTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'create_checklist',
    {
      title: 'Create Checklist',
      description:
        'Create a checklist on a card, with its items in the same call. Name it "Acceptance Criteria" for acceptance criteria.',
      inputSchema: {
        name: z.string().describe('Name of the checklist to create'),
        cardId: z.string().describe('ID of the Trello card'),
        items: z
          .array(z.string())
          .optional()
          .describe('Items to add, in order (none if not provided)'),
      },
    },
    async ({ name, cardId, items }) =>
      json(() => client.createChecklist(name, cardId, items), shape.checklist)
  );

  server.registerTool(
    'get_checklist_items',
    {
      title: 'Get Checklist Items',
      description: 'Get all items from a checklist by name',
      inputSchema: {
        name: z.string().describe('Name of the checklist to retrieve items from'),
        cardId: z
          .string()
          .optional()
          .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
      },
    },
    async ({ name, cardId, boardId }) => json(() => client.getChecklistItems(name, cardId, boardId))
  );

  server.registerTool(
    'get_checklist_by_name',
    {
      title: 'Get Checklist by Name',
      description: 'Get a complete checklist with all its items and completion percentage',
      inputSchema: {
        name: z.string().describe('Name of the checklist to retrieve'),
        cardId: z
          .string()
          .optional()
          .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
      },
    },
    async ({ name, cardId, boardId }) =>
      safe(async () => {
        const checklist = await client.getChecklistByName(name, cardId, boardId);
        if (!checklist) {
          return {
            content: [{ type: 'text' as const, text: `Checklist "${name}" not found` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(checklist) }],
        };
      })
  );

  server.registerTool(
    'get_acceptance_criteria',
    {
      title: 'Get Acceptance Criteria',
      description:
        'Get a card\'s (or board\'s) acceptance criteria. Matches a checklist named "Acceptance Criteria", "AC", "DoD", or "Definition of Done" (case-insensitive); first match in that order wins. Returns a {found: true|false} union; read reason when not found.',
      inputSchema: {
        cardId: z
          .string()
          .optional()
          .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
      },
    },
    async ({ cardId, boardId }) => json(() => client.getAcceptanceCriteria(cardId, boardId))
  );

  server.registerTool(
    'find_checklist_items_by_description',
    {
      title: 'Find Checklist Items by Description',
      description: 'Search for checklist items containing specific text in their description',
      inputSchema: {
        description: z.string().describe('Text to search for in checklist item descriptions'),
        cardId: z
          .string()
          .optional()
          .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
      },
    },
    async ({ description, cardId, boardId }) =>
      json(() => client.findChecklistItemsByDescription(description, cardId, boardId))
  );

  server.registerTool(
    'add_checklist_item',
    {
      title: 'Add Checklist Item',
      description: 'Add a new item to a checklist',
      inputSchema: {
        text: z.string().describe('Text content of the checklist item'),
        checkListName: z.string().describe('Name of the checklist to add the item to'),
        cardId: z
          .string()
          .optional()
          .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
      },
    },
    async ({ text, checkListName, cardId, boardId }) =>
      json(() => client.addChecklistItem(text, checkListName, cardId, boardId))
  );

  server.registerTool(
    'update_checklist_item',
    {
      title: 'Update Checklist Item',
      description:
        'Update a checklist item name, state, position, due date, reminder, or assigned member',
      inputSchema: {
        cardId: z.string().describe('ID of the card containing the checklist item'),
        checkItemId: z.string().describe('ID of the checklist item to update'),
        state: z
          .enum(['complete', 'incomplete'])
          .optional()
          .describe('New state for the checklist item'),
        name: z.string().optional().describe('New text for the checklist item'),
        pos: z
          .union([z.number(), z.enum(['top', 'bottom'])])
          .optional()
          .describe('New position for the checklist item'),
        due: z
          .string()
          .nullable()
          .optional()
          .describe('New due date for the checklist item in ISO 8601 format, or null to clear it'),
        dueReminder: z
          .number()
          .nullable()
          .optional()
          .describe('Reminder offset in minutes before due date, or null to clear it'),
        idMember: z
          .string()
          .nullable()
          .optional()
          .describe('Member ID to assign to the checklist item, or null to clear it'),
      },
    },
    async ({ cardId, checkItemId, name, state, pos, due, dueReminder, idMember }) =>
      json(
        () =>
          client.updateChecklistItem(cardId, checkItemId, {
            name,
            state,
            pos,
            due,
            dueReminder,
            idMember,
          }),
        shape.checkItem
      )
  );

  server.registerTool(
    'delete_checklist_item',
    {
      title: 'Delete Checklist Item',
      description: 'Delete a checklist item from a card',
      inputSchema: {
        cardId: z.string().describe('ID of the card containing the checklist item'),
        checkItemId: z.string().describe('ID of the checklist item to delete'),
      },
    },
    async ({ cardId, checkItemId }) =>
      json(async () => ({ deleted: await client.deleteChecklistItem(cardId, checkItemId) }))
  );

  server.registerTool(
    'copy_checklist',
    {
      title: 'Copy Checklist',
      description:
        'Copy a checklist (with all its items) from one card to another. Works across different boards.',
      inputSchema: {
        sourceChecklistId: z.string().describe('ID of the source checklist to copy'),
        cardId: z.string().describe('ID of the destination card to copy the checklist to'),
        name: z
          .string()
          .optional()
          .describe(
            'Override the name of the copied checklist (defaults to source checklist name)'
          ),
        pos: z
          .string()
          .optional()
          .describe('Position of the new checklist: "top", "bottom", or a positive number'),
      },
    },
    async ({ sourceChecklistId, cardId, name, pos }) =>
      json(() => client.copyChecklist({ sourceChecklistId, cardId, name, pos }), shape.checklist)
  );
}

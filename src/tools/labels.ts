import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import * as shape from '../reply/shape.js';
import { json, safe } from '../reply/respond.js';

/** The label tools, on a board and on a card. */
export function registerLabelTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'get_board_labels',
    {
      title: 'Get Board Labels',
      description: 'Get all labels of a specific board',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ boardId, raw }) =>
      json(() => client.getBoardLabels(boardId), raw ? undefined : shape.many(shape.label))
  );

  server.registerTool(
    'create_label',
    {
      title: 'Create Label',
      description: 'Create a new label on a board',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
        name: z.string().describe('Name of the label'),
        color: z
          .string()
          .optional()
          .describe(
            'Color of the label (e.g., "red", "blue", "green", "yellow", "orange", "purple", "pink", "sky", "lime", "black", "null")'
          ),
      },
    },
    async ({ boardId, name, color }) =>
      json(() => client.createLabel(boardId, name, color), shape.label)
  );

  server.registerTool(
    'update_label',
    {
      title: 'Update Label',
      description: 'Update an existing label',
      inputSchema: {
        labelId: z.string().describe('ID of the label to update'),
        name: z.string().optional().describe('New name for the label'),
        color: z.string().optional().describe('New color for the label'),
      },
    },
    async ({ labelId, name, color }) =>
      json(() => client.updateLabel(labelId, name, color), shape.label)
  );

  server.registerTool(
    'delete_label',
    {
      title: 'Delete Label',
      description: 'Delete a label from a board',
      inputSchema: {
        labelId: z.string().describe('ID of the label to delete'),
      },
    },
    async ({ labelId }) =>
      safe(async () => {
        await client.deleteLabel(labelId);
        return {
          content: [{ type: 'text' as const, text: 'Label deleted successfully' }],
        };
      })
  );

  server.registerTool(
    'add_label_to_card',
    {
      title: 'Add Label to Card',
      description:
        'Add one label to a card. The labels already on the card stay. Get label IDs from get_board_labels.',
      inputSchema: {
        cardId: z.string().describe('ID of the card'),
        labelId: z.string().describe('ID of the label to add'),
      },
    },
    async ({ cardId, labelId }) => json(() => client.addLabelToCard(cardId, labelId))
  );

  server.registerTool(
    'remove_label_from_card',
    {
      title: 'Remove Label from Card',
      description: 'Remove one label from a card. The other labels on the card stay.',
      inputSchema: {
        cardId: z.string().describe('ID of the card'),
        labelId: z.string().describe('ID of the label to remove'),
      },
    },
    async ({ cardId, labelId }) => json(() => client.removeLabelFromCard(cardId, labelId))
  );
}

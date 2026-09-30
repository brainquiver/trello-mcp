import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import { json, safe } from '../reply/respond.js';

/** The custom field tools. They read and set fields that already exist on a board. */
export function registerCustomFieldTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'get_board_custom_fields',
    {
      title: 'Get Board Custom Fields',
      description:
        'Get all custom field definitions on a board. Returns field IDs, names, and types. ' +
        'For dropdown/list fields, also returns available options with their IDs. ' +
        'No tool creates a field, so a board without fields returns an empty list.',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
      },
    },
    async ({ boardId }) =>
      safe(async () => {
        const fields = await client.getBoardCustomFields(boardId);

        const fieldsWithOptions = await Promise.all(
          fields.map(async field => {
            if (field.type !== 'list') {
              return field;
            }

            try {
              const options = await client.getCustomFieldOptions(field.id);
              return { ...field, options };
            } catch (error) {
              return {
                ...field,
                optionsError: error instanceof Error ? error.message : 'Failed to fetch options',
              };
            }
          })
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(fieldsWithOptions) }],
        };
      })
  );

  server.registerTool(
    'update_card_custom_field',
    {
      title: 'Update Card Custom Field',
      description:
        'Set or clear a custom field value on a card. ' +
        'Use get_board_custom_fields first to find field IDs and types. ' +
        'Value format depends on type: text=any string, number=numeric string, ' +
        'checkbox="true"/"false", date=ISO 8601 string, list=option ID from get_board_custom_fields. ' +
        'To clear a field, set type to "clear" and omit value.',
      inputSchema: {
        cardId: z.string().describe('ID of the card to update'),
        customFieldId: z.string().describe('ID of the custom field definition'),
        type: z
          .enum(['text', 'number', 'checkbox', 'date', 'list', 'clear'])
          .describe('The custom field type. Use "clear" to remove the value from the field.'),
        value: z
          .string()
          .optional()
          .describe(
            'The value to set. For text: any string. For number: numeric string (e.g. "42.5"). ' +
              'For checkbox: "true" or "false". For date: ISO 8601 (e.g. "2025-12-31T00:00:00.000Z"). ' +
              'For list: the option ID. Not needed when type is "clear".'
          ),
      },
    },
    async ({ cardId, customFieldId, type, value }) =>
      json(async () => {
        if (type !== 'clear' && !value) {
          throw new McpError(ErrorCode.InvalidParams, 'value is required when type is not "clear"');
        }
        return client.updateCardCustomField(cardId, customFieldId, { type, value });
      })
  );
}

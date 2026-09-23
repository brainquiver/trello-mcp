import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import * as shape from '../reply/shape.js';
import { json } from '../reply/respond.js';

/** The list tools. */
export function registerListTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'get_lists',
    {
      title: 'Get Lists',
      description: 'Retrieve all lists from the specified board',
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
      json(() => client.getLists(boardId), raw ? undefined : shape.many(shape.list))
  );

  server.registerTool(
    'add_list_to_board',
    {
      title: 'Add List to Board',
      description: 'Add a new list to the specified board',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
        name: z.string().describe('Name of the new list'),
      },
    },
    async ({ boardId, name }) => json(() => client.addList(boardId, name), shape.list)
  );

  server.registerTool(
    'update_list',
    {
      title: 'Update List',
      description:
        'Update a list name, archive state, subscription state, or board. Use update_list_position for moving a list within a board.',
      inputSchema: {
        listId: z.string().describe('ID of the Trello list to update'),
        name: z.string().optional().describe('New name for the list'),
        closed: z.boolean().optional().describe('Whether to close (archive) the list'),
        subscribed: z
          .boolean()
          .optional()
          .describe('Whether the authenticated user is subscribed to the list'),
        idBoard: z.string().optional().describe('ID of a board to move the list to'),
      },
    },
    async ({ listId, name, closed, subscribed, idBoard }) =>
      json(async () => {
        const params = Object.fromEntries(
          Object.entries({ name, closed, subscribed, idBoard }).filter(([, v]) => v !== undefined)
        );
        if (Object.keys(params).length === 0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'At least one of name, closed, subscribed, or idBoard must be provided'
          );
        }
        return client.updateList(listId, params);
      }, shape.list)
  );

  server.registerTool(
    'update_list_position',
    {
      title: 'Update List Position',
      description:
        'Update the position of a list on the board. Trello uses fractional indexing: each list has a float position, and to place a list between two others, use the average of their positions (e.g., between pos 1024 and 2048, use 1536). Use "top"/"bottom" shortcuts to move to the edges.',
      inputSchema: {
        listId: z.string().describe('ID of the list to reposition'),
        position: z
          .string()
          .refine(
            val => {
              if (val === 'top' || val === 'bottom') return true;
              const num = Number(val);
              return num > 0 && isFinite(num);
            },
            {
              message: "Position must be 'top', 'bottom', or a positive finite numeric string.",
            }
          )
          .describe(
            'New position: "top" (move to leftmost), "bottom" (move to rightmost), or a numeric string (e.g. "1536"). To place between two lists, use the average of their pos values.'
          ),
      },
    },
    async ({ listId, position }) =>
      json(
        // The schema already refuses anything but top, bottom or a positive number.
        () =>
          client.updateListPosition(
            listId,
            position === 'top' || position === 'bottom' ? position : Number(position)
          ),
        shape.list
      )
  );

  server.registerTool(
    'archive_list',
    {
      title: 'Archive List',
      description: 'Send a list to the archive on a specific board',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe('Board the list is on. If given, a list on any other board is refused'),
        listId: z.string().describe('ID of the list to archive'),
      },
    },
    async ({ boardId, listId }) => json(() => client.archiveList(boardId, listId), shape.list)
  );

  server.registerTool(
    'watch_list',
    {
      title: 'Watch List',
      description: 'Subscribe or unsubscribe from watching a list for activity notifications',
      inputSchema: {
        listId: z.string().describe('ID of the list to watch/unwatch'),
        subscribed: z.boolean().describe('Set to true to start watching, false to stop'),
      },
    },
    async ({ listId, subscribed }) => json(() => client.watchList(listId, subscribed), shape.list)
  );
}

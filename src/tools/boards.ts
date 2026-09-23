import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import * as shape from '../reply/shape.js';
import { json, safe } from '../reply/respond.js';

/** The board and workspace tools, and the active board and workspace they default to. */
export function registerBoardTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'list_boards',
    {
      title: 'List Boards',
      description: 'List all boards the user has access to',
      inputSchema: {
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ raw }) => json(() => client.listBoards(), raw ? undefined : shape.many(shape.board))
  );

  server.registerTool(
    'set_active_board',
    {
      title: 'Set Active Board',
      description: 'Set the active board for future operations',
      inputSchema: {
        boardId: z.string().describe('ID of the board to set as active'),
      },
    },
    async ({ boardId }) =>
      safe(async () => {
        const board = await client.setActiveBoard(boardId);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Successfully set active board to "${board.name}" (${board.id})`,
            },
          ],
        };
      })
  );

  server.registerTool(
    'get_active_board_info',
    {
      title: 'Get Active Board Info',
      description: 'Get information about the currently active board',
      inputSchema: {},
    },
    async () =>
      safe(async () => {
        const boardId = client.activeBoardId;
        if (!boardId) {
          return {
            content: [{ type: 'text' as const, text: 'No active board set' }],
            isError: true,
          };
        }
        const board = await client.getBoardById(boardId);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ...shape.board(board),
                isActive: true,
                activeWorkspaceId: client.activeWorkspaceId || 'Not set',
              }),
            },
          ],
        };
      })
  );

  server.registerTool(
    'list_workspaces',
    {
      title: 'List Workspaces',
      description:
        'List workspaces the user has access to. If TRELLO_ALLOWED_WORKSPACES is configured, only allowed workspaces are returned.',
      inputSchema: {
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ raw }) =>
      json(() => client.listWorkspaces(), raw ? undefined : shape.many(shape.workspace))
  );

  server.registerTool(
    'set_active_workspace',
    {
      title: 'Set Active Workspace',
      description: 'Set the active workspace for future operations',
      inputSchema: {
        workspaceId: z.string().describe('ID of the workspace to set as active'),
      },
    },
    async ({ workspaceId }) =>
      safe(async () => {
        const workspace = await client.setActiveWorkspace(workspaceId);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Successfully set active workspace to "${workspace.displayName}" (${workspace.id})`,
            },
          ],
        };
      })
  );

  server.registerTool(
    'list_boards_in_workspace',
    {
      title: 'List Boards in Workspace',
      description: 'List all boards in a specific workspace',
      inputSchema: {
        workspaceId: z.string().describe('ID of the workspace to list boards from'),
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ workspaceId, raw }) =>
      json(
        () => client.listBoardsInWorkspace(workspaceId),
        raw ? undefined : shape.many(shape.board)
      )
  );

  server.registerTool(
    'create_board',
    {
      title: 'Create Board',
      description: 'Create a new Trello board optionally within a workspace',
      inputSchema: {
        name: z.string().describe('Name of the board'),
        desc: z.string().optional().describe('Description of the board'),
        idOrganization: z
          .string()
          .min(1)
          .optional()
          .describe('Workspace ID to create the board in (uses active if not provided)'),
        defaultLabels: z
          .boolean()
          .optional()
          .default(true)
          .describe('Create default labels (true by default)'),
        defaultLists: z
          .boolean()
          .optional()
          .default(true)
          .describe('Create default lists (true by default)'),
      },
    },
    async ({ name, desc, idOrganization, defaultLabels, defaultLists }) =>
      json(
        () => client.createBoard({ name, desc, idOrganization, defaultLabels, defaultLists }),
        shape.board
      )
  );

  server.registerTool(
    'get_recent_activity',
    {
      title: 'Get Recent Activity',
      description: 'Fetch recent activity on the Trello board',
      inputSchema: {
        boardId: z
          .string()
          .optional()
          .describe('ID of the Trello board (uses default if not provided)'),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe('Number of activities to fetch (default: 10)'),
        since: z
          .string()
          .optional()
          .describe('Only return actions after this date (ISO 8601) or action ID'),
        before: z
          .string()
          .optional()
          .describe('Only return actions before this date (ISO 8601) or action ID'),
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ boardId, limit, since, before, raw }) =>
      json(
        () => client.getRecentActivity(boardId, limit, since, before),
        raw ? undefined : shape.many(shape.action)
      )
  );
}

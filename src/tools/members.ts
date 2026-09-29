import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import * as shape from '../reply/shape.js';
import { json } from '../reply/respond.js';

/** The member tools. */
export function registerMemberTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'get_board_members',
    {
      title: 'Get Board Members',
      description: 'Get all members of a specific board',
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
      json(() => client.getBoardMembers(boardId), raw ? undefined : shape.many(shape.member))
  );

  server.registerTool(
    'assign_member_to_card',
    {
      title: 'Assign Member to Card',
      description: 'Assign a member to a specific card',
      inputSchema: {
        cardId: z.string().describe('ID of the card to assign the member to'),
        memberId: z.string().describe('ID of the member to assign to the card'),
      },
    },
    async ({ cardId, memberId }) =>
      json(() => client.assignMemberToCard(cardId, memberId), shape.many(shape.member))
  );

  server.registerTool(
    'remove_member_from_card',
    {
      title: 'Remove Member from Card',
      description: 'Remove a member from a specific card',
      inputSchema: {
        cardId: z.string().describe('ID of the card to remove the member from'),
        memberId: z.string().describe('ID of the member to remove from the card'),
      },
    },
    async ({ cardId, memberId }) =>
      json(() => client.removeMemberFromCard(cardId, memberId), shape.many(shape.member))
  );
}

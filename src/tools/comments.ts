import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import * as shape from '../reply/shape.js';
import { json, safe } from '../reply/respond.js';

/** The comment tools. */
export function registerCommentTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'get_card_comments',
    {
      title: 'Get Card Comments',
      description: 'Retrieve all comments from a specific Trello card',
      inputSchema: {
        cardId: z.string().describe('ID of the card to get comments from'),
        limit: z
          .number()
          .optional()
          .default(100)
          .describe('Maximum number of comments to retrieve (default: 100)'),
        raw: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return Trello's full reply instead of the trimmed one (default: false)"),
      },
    },
    async ({ cardId, limit, raw }) =>
      json(() => client.getCardComments(cardId, limit), raw ? undefined : shape.many(shape.comment))
  );

  server.registerTool(
    'add_comment',
    {
      title: 'Add Comment to Card',
      description: 'Add the given text as a new comment to the given card',
      inputSchema: {
        cardId: z.string().describe('ID of the card to comment on'),
        text: z.string().describe('The text of the comment to add'),
      },
    },
    async ({ cardId, text }) => json(() => client.addCommentToCard(cardId, text), shape.comment)
  );

  server.registerTool(
    'update_comment',
    {
      title: 'Update Comment on Card',
      description: 'Update the given comment with the new text',
      inputSchema: {
        commentId: z.string().describe('ID of the comment to change'),
        text: z.string().describe('The new text of the comment'),
      },
    },
    async ({ commentId, text }) =>
      safe(async () => {
        const success = await client.updateCommentOnCard(commentId, text);
        return {
          content: [{ type: 'text' as const, text: success ? 'success' : 'failure' }],
        };
      })
  );

  server.registerTool(
    'delete_comment',
    {
      title: 'Delete Comment from Card',
      description: 'Delete a comment from a Trello card',
      inputSchema: {
        commentId: z.string().describe('ID of the comment to delete'),
      },
    },
    async ({ commentId }) =>
      safe(async () => {
        const success = await client.deleteCommentFromCard(commentId);
        return {
          content: [{ type: 'text' as const, text: success ? 'success' : 'failure' }],
        };
      })
  );
}

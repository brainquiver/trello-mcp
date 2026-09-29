import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrelloClient } from './trello/client.js';
import { registerBoardTools } from './tools/boards.js';
import { registerListTools } from './tools/lists.js';
import { registerCardTools } from './tools/cards.js';
import { registerCommentTools } from './tools/comments.js';
import { registerChecklistTools } from './tools/checklists.js';
import { registerAttachmentTools } from './tools/attachments.js';
import { registerLabelTools } from './tools/labels.js';
import { registerMemberTools } from './tools/members.js';
import { registerCustomFieldTools } from './tools/custom-fields.js';

/**
 * The MCP server with every tool on the given client. It is apart from index.ts, so a test
 * can connect to it without stdio.
 */
export function buildServer(client: TrelloClient): McpServer {
  const server = new McpServer({
    name: 'trello-mcp',
    version: '1.0.0',
  });
  for (const register of [
    registerBoardTools,
    registerListTools,
    registerCardTools,
    registerCommentTools,
    registerChecklistTools,
    registerAttachmentTools,
    registerLabelTools,
    registerMemberTools,
    registerCustomFieldTools,
  ]) {
    register(server, client);
  }
  return server;
}

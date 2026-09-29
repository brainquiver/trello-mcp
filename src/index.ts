#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
 * A positive number from the environment, or undefined when unset so the client's default
 * applies. Anything else stops the server with the reason, never a silent fallback.
 */
function positiveNumber(name: string, { whole = false } = {}): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (whole && !Number.isInteger(value))) {
    throw new Error(
      `${name} must be a positive ${whole ? 'whole number' : 'number'}, got "${raw}"`
    );
  }
  return value;
}

class TrelloServer {
  private server: McpServer;
  private trelloClient: TrelloClient;

  constructor() {
    const apiKey = process.env.TRELLO_API_KEY;
    const token = process.env.TRELLO_TOKEN;
    const allowedWorkspacesEnv = process.env.TRELLO_ALLOWED_WORKSPACES;

    if (!apiKey || !token) {
      throw new Error('TRELLO_API_KEY and TRELLO_TOKEN environment variables are required');
    }

    const allowedWorkspaceIds = allowedWorkspacesEnv
      ? allowedWorkspacesEnv
          .split(',')
          .map(id => id.trim())
          .filter(id => id.length > 0)
      : undefined;

    this.trelloClient = new TrelloClient({
      apiKey,
      token,
      boardId: process.env.TRELLO_BOARD_ID,
      allowedWorkspaceIds,
      attachRoot: process.env.TRELLO_ATTACH_ROOT?.trim() || undefined,
      descriptionLimit: positiveNumber('TRELLO_DESCRIPTION_LIMIT', { whole: true }),
      maxDownloadMb: positiveNumber('TRELLO_MAX_DOWNLOAD_MB'),
    });

    this.server = new McpServer({
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
      register(this.server, this.trelloClient);
    }

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    // The saved active board and workspace. A missing or unreadable file leaves the defaults.
    await this.trelloClient.loadConfig().catch(() => {});
    await this.server.connect(transport);
  }
}

Promise.resolve()
  .then(() => new TrelloServer().run())
  .catch(error => {
    // stdout carries the protocol, so the reason for stopping goes to stderr.
    console.error(`trello-mcp: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });

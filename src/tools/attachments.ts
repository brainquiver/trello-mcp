import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from './zod.js';
import { TrelloClient } from '../trello/client.js';
import * as shape from '../reply/shape.js';
import { json, safe } from '../reply/respond.js';

/** The attachment tools. */
export function registerAttachmentTools(server: McpServer, client: TrelloClient): void {
  server.registerTool(
    'attach_to_card',
    {
      title: 'Attach to Card',
      description:
        'Attach something to a card. The start of source decides what happens: https:// stores a link, and the file stays at that URL; file:// uploads a local file from the folder in TRELLO_ATTACH_ROOT, and is refused when that is not set; data:<mime>;base64,<data> uploads inline data.',
      inputSchema: {
        cardId: z.string().describe('ID of the card to attach to'),
        source: z
          .string()
          .describe('An https:// URL, a file:// URL, or a data:<mime>;base64,<data> URL'),
        name: z
          .string()
          .optional()
          .describe(
            "Name of the attachment on the card. A name without an extension takes the source's. Defaults to the file name, or attachment-<time> for inline data"
          ),
        mimeType: z
          .string()
          .optional()
          .describe('MIME type. Defaults to the one the extension or the data URL gives'),
      },
    },
    async ({ cardId, source, name, mimeType }) =>
      json(() => client.attachToCard(cardId, source, name, mimeType), shape.attachment)
  );

  server.registerTool(
    'download_attachment',
    {
      title: 'Download Attachment',
      description: `Download an uploaded attachment from a card. Returns base64-encoded data that can be saved or viewed. A link attachment has no file on Trello, and a file over ${client.maxDownloadMb} MB would flood the context, so both are refused.`,
      inputSchema: {
        cardId: z.string().describe('ID of the card containing the attachment'),
        attachmentId: z.string().describe('ID of the attachment to download'),
      },
    },
    async ({ cardId, attachmentId }) =>
      safe(async () => {
        const result = await client.downloadAttachment(cardId, attachmentId);

        if (result.mimeType.startsWith('image/')) {
          return {
            content: [
              {
                type: 'image' as const,
                data: result.data,
                mimeType: result.mimeType,
              },
              {
                type: 'text' as const,
                text: `Downloaded: ${result.fileName} (${result.mimeType})`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                fileName: result.fileName,
                mimeType: result.mimeType,
                data: result.data,
              }),
            },
          ],
        };
      })
  );
}

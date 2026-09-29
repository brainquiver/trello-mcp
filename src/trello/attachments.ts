import { AxiosInstance } from 'axios';
import FormData from 'form-data';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TrelloAttachment } from './types.js';
import { validateExternalUrl } from './url-validator.js';

export const MIME_TYPES: Readonly<{ [key: string]: string }> = Object.freeze({
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Text
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.log': 'text/plain',

  // Code
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',

  // Archives
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',

  // Media
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.webm': 'video/webm',
});

const DEFAULT_MIME_TYPE = 'application/octet-stream';

function mimeFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext];
}

function extensionFromMime(mimeType: string): string {
  const match = Object.entries(MIME_TYPES).find(([, mime]) => mime === mimeType);
  return match?.[0] ?? '';
}

export interface AttachParams {
  cardId: string;
  source: string;
  name?: string;
  mimeType?: string;
  // The one folder a file:// source may come from. Unset, local uploads are refused.
  attachRoot?: string;
}

// The prefix of source picks the operation: https:// stores a link, file:// uploads a
// local file, and data: uploads inline bytes. Anything else is refused, never guessed.
export async function attach(
  axiosInstance: AxiosInstance,
  params: AttachParams
): Promise<TrelloAttachment> {
  const { source } = params;
  if (source.startsWith('https://')) return attachLink(axiosInstance, params);
  if (source.startsWith('file://')) return uploadLocalFile(axiosInstance, params);
  if (source.startsWith('data:')) return uploadData(axiosInstance, params);
  throw new McpError(
    ErrorCode.InvalidRequest,
    'source must start with https://, file:// or data:. Wrap inline bytes as data:<mime>;base64,<data>.'
  );
}

// A name without an extension takes the source's, so a download still opens.
function withExtension(name: string, extension: string): string {
  return path.extname(name) ? name : `${name}${extension}`;
}

async function attachLink(
  axiosInstance: AxiosInstance,
  { cardId, source, name, mimeType }: AttachParams
): Promise<TrelloAttachment> {
  validateExternalUrl(source);
  const urlPath = decodeURIComponent(new URL(source).pathname);
  const effectiveMimeType = mimeType || mimeFromFilename(urlPath) || DEFAULT_MIME_TYPE;
  const extension = path.extname(urlPath) || extensionFromMime(effectiveMimeType);
  const fileName = name ? withExtension(name, extension) : path.basename(urlPath) || undefined;

  const response = await axiosInstance.post(`/cards/${cardId}/attachments`, {
    url: source,
    name: fileName,
    mimeType: effectiveMimeType,
  });
  return response.data;
}

async function uploadLocalFile(
  axiosInstance: AxiosInstance,
  { cardId, source, name, mimeType, attachRoot }: AttachParams
): Promise<TrelloAttachment> {
  let requested: string;
  try {
    requested = fileURLToPath(source);
  } catch {
    throw new McpError(ErrorCode.InvalidRequest, `Invalid file URL: ${source}`);
  }
  const localPath = await insideAttachRoot(requested, attachRoot);

  const effectiveMimeType = mimeType || mimeFromFilename(localPath) || DEFAULT_MIME_TYPE;
  const extension = path.extname(localPath) || extensionFromMime(effectiveMimeType);
  const fileName = name ? withExtension(name, extension) : path.basename(localPath);
  return upload(axiosInstance, cardId, await fs.readFile(localPath), fileName, effectiveMimeType);
}

/**
 * A card's text can ask an agent to attach any file, a key or a .env included, and an
 * attachment is readable by everyone on the board. So a file:// source must sit inside
 * the one folder the user named. The check runs on the real path, so ../ and a symlink
 * cannot lead out of it. Returns the real path, which is the one read.
 */
async function insideAttachRoot(
  requested: string,
  attachRoot: string | undefined
): Promise<string> {
  if (!attachRoot) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Local file uploads are off, because TRELLO_ATTACH_ROOT is not set. Tell the user: to allow them, set TRELLO_ATTACH_ROOT in the server environment to the one folder files may be uploaded from, then restart the server. An https:// link or a data: source works without it.'
    );
  }
  let root: string;
  try {
    root = await fs.realpath(attachRoot);
  } catch {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `TRELLO_ATTACH_ROOT is ${attachRoot}, which does not exist. Tell the user to point it at an existing folder and restart the server.`
    );
  }
  let real: string;
  try {
    real = await fs.realpath(requested);
  } catch {
    throw new McpError(ErrorCode.InvalidRequest, `File not found: ${requested}`);
  }
  // Only a relative path that climbs starts with the .. folder. A name such as ..notes.txt
  // is a file inside the root.
  const relative = path.relative(root, real);
  const climbs = relative === '..' || relative.startsWith(`..${path.sep}`);
  if (!relative || climbs || path.isAbsolute(relative)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Refused: ${requested} is outside TRELLO_ATTACH_ROOT (${root}). Nothing was uploaded. Move the file into that folder, or tell the user, who can change TRELLO_ATTACH_ROOT.`
    );
  }
  if (!(await fs.stat(real)).isFile()) {
    throw new McpError(ErrorCode.InvalidRequest, `Not a file: ${requested}`);
  }
  return real;
}

async function uploadData(
  axiosInstance: AxiosInstance,
  { cardId, source, name, mimeType }: AttachParams
): Promise<TrelloAttachment> {
  // A data URL can carry parameters such as charset after the type, and base64 is often
  // wrapped in lines of 76 characters. Both are valid, so both are accepted.
  const matches = source.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/);
  if (!matches) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Invalid data URL, expected data:<mime>;base64,<data>'
    );
  }
  const base64 = matches[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Invalid data URL: the part after "base64," is not valid base64. Nothing was uploaded.'
    );
  }

  const effectiveMimeType = mimeType || matches[1];
  const extension = extensionFromMime(effectiveMimeType);
  const fileName = name ? withExtension(name, extension) : `attachment-${Date.now()}${extension}`;
  return upload(axiosInstance, cardId, Buffer.from(base64, 'base64'), fileName, effectiveMimeType);
}

/**
 * Send the bytes as a multipart form. The body is one Buffer, because the client sends a
 * request again after a 429. A stream is empty the second time.
 */
async function upload(
  axiosInstance: AxiosInstance,
  cardId: string,
  bytes: Buffer,
  fileName: string,
  mimeType: string
): Promise<TrelloAttachment> {
  const form = new FormData();
  form.append('file', bytes, { filename: fileName, contentType: mimeType });
  form.append('name', fileName);
  form.append('mimeType', mimeType);
  const response = await axiosInstance.post(`/cards/${cardId}/attachments`, form.getBuffer(), {
    headers: form.getHeaders(),
  });
  return response.data;
}

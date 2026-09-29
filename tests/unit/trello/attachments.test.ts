import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosInstance } from 'axios';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { AddressInfo } from 'net';
import { attach, MIME_TYPES } from '../../../src/trello/attachments.js';
import { TrelloClient } from '../../../src/trello/client.js';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual };
});

function createAxiosMock(): AxiosInstance {
  const post = vi.fn().mockResolvedValue({ data: { id: 'a1' } });
  const get = vi.fn();
  return { post, get } as unknown as AxiosInstance;
}

describe('attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MIME_TYPES', () => {
    it('should be frozen', () => {
      expect(Object.isFrozen(MIME_TYPES)).toBe(true);
    });

    it('should map common extensions', () => {
      expect(MIME_TYPES['.md']).toBe('text/markdown');
      expect(MIME_TYPES['.pdf']).toBe('application/pdf');
      expect(MIME_TYPES['.png']).toBe('image/png');
    });
  });

  describe('attach', () => {
    const b64 = (text: string) => Buffer.from(text).toString('base64');
    const lastForm = (axiosInstance: AxiosInstance) =>
      (axiosInstance.post as ReturnType<typeof vi.fn>).mock.calls[0][1];

    describe('routing', () => {
      it('refuses a source without a known prefix and never uploads', async () => {
        const axiosInstance = createAxiosMock();

        await expect(attach(axiosInstance, { cardId: 'c1', source: b64('raw') })).rejects.toThrow(
          /must start with https:\/\/, file:\/\/ or data:/
        );
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });

      it('refuses a plain http:// URL', async () => {
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: 'http://example.com/a.png' })
        ).rejects.toThrow();
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });
    });

    describe('https:// link', () => {
      it('stores a link with the name and mime type given', async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: 'https://example.com/doc.pdf',
          name: 'doc.pdf',
          mimeType: 'application/pdf',
        });

        expect(axiosInstance.post).toHaveBeenCalledWith('/cards/c1/attachments', {
          url: 'https://example.com/doc.pdf',
          name: 'doc.pdf',
          mimeType: 'application/pdf',
        });
      });

      it('defaults the name to the last part of the URL and the mime type to its extension', async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, { cardId: 'c1', source: 'https://example.com/notes.md' });

        expect(axiosInstance.post).toHaveBeenCalledWith('/cards/c1/attachments', {
          url: 'https://example.com/notes.md',
          name: 'notes.md',
          mimeType: 'text/markdown',
        });
      });

      it("adds the URL's extension to a name that has none", async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: 'https://example.com/screenshot-2026-09-23-1326.png',
          name: 'test-56-chat-button',
        });

        expect(axiosInstance.post).toHaveBeenCalledWith(
          '/cards/c1/attachments',
          expect.objectContaining({ name: 'test-56-chat-button.png' })
        );
      });

      it('refuses a URL that points at a private address', async () => {
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: 'https://127.0.0.1/a.png' })
        ).rejects.toThrow(/private or local/);
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });
    });

    describe('file:// upload', () => {
      let root: string;
      let outside: string;

      beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'attach-root-'));
        outside = await fs.mkdtemp(path.join(os.tmpdir(), 'attach-outside-'));
      });

      afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(outside, { recursive: true, force: true });
      });

      const fields = (axiosInstance: AxiosInstance) =>
        (lastForm(axiosInstance) as Buffer).toString();

      it('uploads a file inside the root as multipart form data under its own name', async () => {
        const file = path.join(root, 'notes.md');
        await fs.writeFile(file, '# hello');
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, { cardId: 'c1', source: `file://${file}`, attachRoot: root });

        expect(axiosInstance.post).toHaveBeenCalledWith(
          '/cards/c1/attachments',
          expect.anything(),
          expect.objectContaining({ headers: expect.any(Object) })
        );
        expect(fields(axiosInstance)).toContain('text/markdown');
        expect(fields(axiosInstance)).toContain('notes.md');
      });

      it('uploads a file in a folder below the root', async () => {
        await fs.mkdir(path.join(root, 'shots'));
        const file = path.join(root, 'shots', 'a.png');
        await fs.writeFile(file, 'png');
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, { cardId: 'c1', source: `file://${file}`, attachRoot: root });

        expect(axiosInstance.post).toHaveBeenCalledTimes(1);
      });

      it('uploads a file in the root whose name starts with two dots', async () => {
        const file = path.join(root, '..notes.txt');
        await fs.writeFile(file, 'notes');
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, { cardId: 'c1', source: `file://${file}`, attachRoot: root });

        expect(fields(axiosInstance)).toContain('..notes.txt');
      });

      it("adds the file's extension to a name that has none", async () => {
        const file = path.join(root, 'screenshot-2026-09-23-1326.png');
        await fs.writeFile(file, 'png');
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: `file://${file}`,
          name: 'test-56-chat-button',
          attachRoot: root,
        });

        expect(fields(axiosInstance)).toContain('test-56-chat-button.png');
      });

      it('refuses every local upload when no root is set, and says how to turn them on', async () => {
        const file = path.join(root, 'notes.md');
        await fs.writeFile(file, '# hello');
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: `file://${file}` })
        ).rejects.toThrow(
          'Local file uploads are off, because TRELLO_ATTACH_ROOT is not set. Tell the user: to allow them, set TRELLO_ATTACH_ROOT'
        );
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });

      it('refuses a file outside the root', async () => {
        const file = path.join(outside, 'id_ed25519');
        await fs.writeFile(file, 'secret');
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: `file://${file}`, attachRoot: root })
        ).rejects.toThrow(/is outside TRELLO_ATTACH_ROOT .* Nothing was uploaded/);
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });

      it('refuses a path that climbs out of the root with ../', async () => {
        await fs.writeFile(path.join(outside, 'secret.env'), 'KEY=1');
        const axiosInstance = createAxiosMock();
        const climbing = `${root}/../${path.basename(outside)}/secret.env`;

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: `file://${climbing}`, attachRoot: root })
        ).rejects.toThrow('is outside TRELLO_ATTACH_ROOT');
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });

      it('refuses a symlink inside the root that points out of it', async () => {
        const secret = path.join(outside, 'secret.env');
        await fs.writeFile(secret, 'KEY=1');
        const link = path.join(root, 'innocent.txt');
        await fs.symlink(secret, link);
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: `file://${link}`, attachRoot: root })
        ).rejects.toThrow('is outside TRELLO_ATTACH_ROOT');
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });

      it('refuses the root folder itself and any folder, which are not files', async () => {
        await fs.mkdir(path.join(root, 'sub'));
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: `file://${root}`, attachRoot: root })
        ).rejects.toThrow('is outside TRELLO_ATTACH_ROOT');
        await expect(
          attach(axiosInstance, {
            cardId: 'c1',
            source: `file://${path.join(root, 'sub')}`,
            attachRoot: root,
          })
        ).rejects.toThrow('Not a file');
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });

      it('says so when the root does not exist', async () => {
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, {
            cardId: 'c1',
            source: `file://${path.join(root, 'a.md')}`,
            attachRoot: path.join(root, 'missing'),
          })
        ).rejects.toThrow('which does not exist. Tell the user to point it at an existing folder');
      });

      it('throws on a missing local file', async () => {
        const axiosInstance = createAxiosMock();
        const missing = path.join(root, `does-not-exist-${Date.now()}.txt`);

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: `file://${missing}`, attachRoot: root })
        ).rejects.toThrow(/File not found/);
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });
    });

    describe('data: upload', () => {
      it('takes the mime type and bytes from the data URL', async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: `data:application/pdf;base64,${b64('pdf')}`,
          name: 'r.pdf',
        });

        expect(axiosInstance.post).toHaveBeenCalledWith(
          '/cards/c1/attachments',
          expect.anything(),
          expect.objectContaining({ headers: expect.any(Object) })
        );
        const body = lastForm(axiosInstance).toString();
        expect(body).toContain('application/pdf');
        expect(body).toContain('r.pdf');
      });

      it('lets an explicit mimeType override the one in the data URL', async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: `data:application/octet-stream;base64,${b64('x')}`,
          name: 'a.pdf',
          mimeType: 'application/pdf',
        });

        const body = lastForm(axiosInstance).toString();
        expect(body).toContain('application/pdf');
        expect(body).not.toContain('application/octet-stream');
      });

      it('generates attachment-<time> with the extension when name is omitted', async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: `data:image/png;base64,${b64('png')}`,
        });

        expect(lastForm(axiosInstance).toString()).toMatch(/attachment-\d+\.png/);
      });

      it('omits the extension when the mime type has no entry in MIME_TYPES', async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: `data:application/x-unknown;base64,${b64('blob')}`,
        });

        expect(lastForm(axiosInstance).toString()).toMatch(/attachment-\d+"/);
      });

      it('adds the extension to a name that has none', async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: `data:image/png;base64,${b64('png')}`,
          name: 'test-56-chat-button',
        });

        expect(lastForm(axiosInstance).toString()).toContain('test-56-chat-button.png');
      });

      it('keeps a name that already has an extension', async () => {
        const axiosInstance = createAxiosMock();

        await attach(axiosInstance, {
          cardId: 'c1',
          source: `data:image/png;base64,${b64('png')}`,
          name: 'photo.jpg',
        });

        const body = lastForm(axiosInstance).toString();
        expect(body).toContain('photo.jpg');
        expect(body).not.toContain('photo.jpg.png');
      });

      it('accepts base64 wrapped in lines and a charset parameter', async () => {
        const axiosInstance = createAxiosMock();
        const wrapped = b64('x'.repeat(120)).replace(/(.{76})/g, '$1\r\n');

        await attach(axiosInstance, {
          cardId: 'c1',
          source: `data:text/plain;charset=utf-8;base64,${wrapped}`,
          name: 'notes.txt',
        });

        const body = lastForm(axiosInstance).toString();
        expect(body).toContain('x'.repeat(120));
        expect(body).toContain('text/plain');
      });

      it('refuses data that is not base64 without uploading', async () => {
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: 'data:text/plain;base64,not base64!' })
        ).rejects.toThrow(/is not valid base64/);
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });

      it('rejects a malformed data URL without uploading', async () => {
        const axiosInstance = createAxiosMock();

        await expect(
          attach(axiosInstance, { cardId: 'c1', source: 'data:not-valid', name: 'x.bin' })
        ).rejects.toThrow(/Invalid data URL/);
        expect(axiosInstance.post).not.toHaveBeenCalled();
      });
    });
  });

  describe('retry after a 429', () => {
    let server: http.Server;
    let bodies: number[];

    beforeEach(async () => {
      bodies = [];
      // A fake Trello that refuses the first upload with a 429 and accepts the next one.
      server = http.createServer((req, res) => {
        let size = 0;
        req.on('data', chunk => (size += chunk.length));
        req.on('end', () => {
          bodies.push(size);
          if (bodies.length === 1) {
            res.writeHead(429);
            res.end('rate limit');
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'a1' }));
        });
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    });

    afterEach(async () => {
      await new Promise(resolve => server.close(resolve));
    });

    it('sends the whole upload again, because the body is a Buffer', async () => {
      const client = new TrelloClient({ apiKey: 'k', token: 't' });
      const port = (server.address() as AddressInfo).port;
      (client as unknown as { axiosInstance: AxiosInstance }).axiosInstance.defaults.baseURL =
        `http://127.0.0.1:${port}`;
      const source = `data:text/plain;base64,${Buffer.from('x'.repeat(5000)).toString('base64')}`;

      const result = await client.attachToCard('c1', source, 'notes.txt');

      expect(result).toEqual({ id: 'a1' });
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(bodies[0]).toBeGreaterThan(5000);
    });
  });
});

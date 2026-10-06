/* eslint-disable @typescript-eslint/no-explicit-any -- replies are free-form JSON, checked field by field with expect */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

const TRELLO_API_KEY = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const TEST_BOARD_ID = process.env.TRELLO_TEST_BOARD_ID;

const canRunSmoke = Boolean(TRELLO_API_KEY && TRELLO_TOKEN && TEST_BOARD_ID);

// Optional. Each one turns on the tests that need it.
const OTHER_BOARD_ID = process.env.TRELLO_TEST_OTHER_BOARD_ID;
const WORKSPACE_ID = process.env.TRELLO_TEST_WORKSPACE_ID;
const REFUSED_BOARD_ID = process.env.TRELLO_TEST_REFUSED_BOARD_ID;
const REFUSED_WORKSPACE_ID = process.env.TRELLO_TEST_REFUSED_WORKSPACE_ID;

// A call straight to Trello, for setup that no tool does, as a custom field. A lost connection
// or a 5xx is tried again twice, because one network fault on a CI runner stopped a whole run.
// A repeated create can leave a second field, so the cleanup removes every field by its name.
async function trelloApi(method: string, route: string, body?: unknown): Promise<any> {
  const auth = `key=${TRELLO_API_KEY}&token=${TRELLO_TOKEN}`;
  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetch(`https://api.trello.com/1${route}?${auth}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // fetch throws a TypeError when the connection fails.
      if (!(error instanceof TypeError) || attempt === 3) throw error;
    }
    if (response?.ok) return response.json();
    if (response && (response.status < 500 || attempt === 3)) {
      throw new Error(`${method} ${route}: Trello returned ${response.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
  }
}

/**
 * Helper to communicate with the MCP server over stdio JSON-RPC.
 */
class McpTestClient {
  private server: ChildProcess;
  private buffer = '';
  private requestId = 0;
  private pending = new Map<number, (msg: any) => void>();
  // The server saves the active board in its home folder. A scratch home keeps the suite
  // away from the active board of the person who runs it.
  private readonly home = mkdtempSync(path.join(os.tmpdir(), 'trello-mcp-smoke-'));

  // Settings from the environment of the person who runs the suite never reach the server.
  // Only the ones a test gives in settings do.
  constructor(settings: Record<string, string> = {}) {
    this.server = spawn('node', [path.resolve('build/index.js')], {
      env: {
        ...process.env,
        TRELLO_API_KEY,
        TRELLO_TOKEN,
        TRELLO_BOARD_ID: '',
        TRELLO_ALLOWED_WORKSPACES: '',
        TRELLO_ATTACH_ROOT: '',
        HOME: this.home,
        USERPROFILE: this.home,
        ...settings,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.server.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            if (msg.id && this.pending.has(msg.id)) {
              this.pending.get(msg.id)!(msg);
              this.pending.delete(msg.id);
            }
          } catch {
            // ignore non-JSON lines
          }
        }
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '1.0.0' },
    });
    this.server.stdin!.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );
  }

  /** The whole tool result, for a test that reads isError or a content type. */
  async callToolResult(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const response = await this.request('tools/call', { name, arguments: args });
    return response.result;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const response = await this.request('tools/call', { name, arguments: args });
    if (response.result?.isError) {
      throw new Error(response.result.content[0]?.text || 'Tool call failed');
    }
    const text = response.result.content[0].text;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise(resolve => {
      const id = ++this.requestId;
      this.pending.set(id, resolve);
      this.server.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  close(): void {
    this.server.kill();
    rmSync(this.home, { recursive: true, force: true });
  }
}

describe.skipIf(!canRunSmoke)('Smoke Tests (Live Trello API)', () => {
  let client: McpTestClient;
  let testListId: string;

  // Track created resources for cleanup
  const createdCardIds: string[] = [];
  // Made first and searched for last, because Trello indexes a new card only after a delay.
  const searchWord = `smoke${Date.now()}`;
  let searchTarget: any;

  beforeAll(async () => {
    client = new McpTestClient();
    await client.initialize();

    // Ensure test list exists
    const lists = await client.callTool('get_lists', { boardId: TEST_BOARD_ID });
    if (lists.length > 0) {
      testListId = lists[0].id;
    } else {
      const newList = await client.callTool('add_list_to_board', {
        boardId: TEST_BOARD_ID,
        name: 'Smoke Test List',
      });
      testListId = newList.id;
    }

    searchTarget = await client.callTool('add_card_to_list', {
      listId: testListId,
      name: `Search target ${searchWord}`,
    });
    createdCardIds.push(searchTarget.id);
  });

  afterAll(async () => {
    // Archive the cards made during the tests. A card that is already archived stays archived.
    await Promise.allSettled(
      createdCardIds.map(cardId => client.callTool('archive_card', { cardId }))
    );
    client?.close();
  });

  describe('Board operations', () => {
    it('should list boards', async () => {
      const boards = await client.callTool('list_boards');
      expect(Array.isArray(boards)).toBe(true);
      expect(boards.length).toBeGreaterThan(0);
      expect(boards[0]).toHaveProperty('id');
      expect(boards[0]).toHaveProperty('name');
    });

    it('should get lists from test board', async () => {
      const lists = await client.callTool('get_lists', { boardId: TEST_BOARD_ID });
      expect(Array.isArray(lists)).toBe(true);
      expect(lists.length).toBeGreaterThan(0);
    });

    it('should set and get active board', async () => {
      const setResult = await client.callTool('set_active_board', { boardId: TEST_BOARD_ID });
      expect(typeof setResult).toBe('string'); // returns plain text confirmation
      const info = await client.callTool('get_active_board_info');
      expect(info.id).toBe(TEST_BOARD_ID);
    });
  });

  describe('Card CRUD', () => {
    let cardId: string;

    it('should create a card', async () => {
      const card = await client.callTool('add_card_to_list', {
        listId: testListId,
        name: 'Smoke Test Card',
        description: 'Created by smoke test',
      });
      expect(card).toHaveProperty('id');
      expect(card.name).toBe('Smoke Test Card');
      cardId = card.id;
      createdCardIds.push(cardId);
    });

    it('should get card details', async () => {
      const card = await client.callTool('get_card', { cardId });
      expect(card.id).toBe(cardId);
      expect(card.name).toBe('Smoke Test Card');
      expect(card.desc).toBe('Created by smoke test');
    });

    it('should update card', async () => {
      const updated = await client.callTool('update_card_details', {
        cardId,
        name: 'Updated Smoke Card',
        description: 'Updated by smoke test',
      });
      expect(updated.name).toBe('Updated Smoke Card');
    });

    it('should get cards by list', async () => {
      const cards = await client.callTool('get_cards_by_list_id', { listId: testListId });
      expect(Array.isArray(cards)).toBe(true);
      const found = cards.find((c: any) => c.id === cardId);
      expect(found).toBeTruthy();
    });

    it('should archive card', async () => {
      const archived = await client.callTool('archive_card', { cardId });
      expect(archived.closed).toBe(true);
      // Remove from cleanup since already archived
      const idx = createdCardIds.indexOf(cardId);
      if (idx > -1) createdCardIds.splice(idx, 1);
    });
  });

  describe('Checklist operations', () => {
    let cardId: string;

    beforeAll(async () => {
      const card = await client.callTool('add_card_to_list', {
        listId: testListId,
        name: 'Checklist Test Card',
      });
      cardId = card.id;
      createdCardIds.push(cardId);
    });

    it('should create a checklist', async () => {
      const checklist = await client.callTool('create_checklist', {
        cardId,
        name: 'Test Checklist',
      });
      expect(checklist).toHaveProperty('id');
      expect(checklist.name).toBe('Test Checklist');
    });

    it('should add items to checklist', async () => {
      const item = await client.callTool('add_checklist_item', {
        cardId,
        checkListName: 'Test Checklist',
        text: 'Test Item 1',
      });
      expect(item).toHaveProperty('id');
      expect(item.text).toBe('Test Item 1');
    });

    it('should get checklist by name', async () => {
      const checklist = await client.callTool('get_checklist_by_name', {
        cardId,
        name: 'Test Checklist',
      });
      expect(checklist.name).toBe('Test Checklist');
      expect(checklist.items.length).toBeGreaterThan(0);
    });

    it('should get checklist items', async () => {
      const items = await client.callTool('get_checklist_items', {
        cardId,
        name: 'Test Checklist',
      });
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toHaveProperty('text');
    });
  });

  describe('Comment operations', () => {
    let cardId: string;
    let commentId: string;

    beforeAll(async () => {
      const card = await client.callTool('add_card_to_list', {
        listId: testListId,
        name: 'Comment Test Card',
      });
      cardId = card.id;
      createdCardIds.push(cardId);
    });

    it('should add a comment', async () => {
      const comment = await client.callTool('add_comment', {
        cardId,
        text: 'Smoke test comment',
      });
      expect(comment).toHaveProperty('id');
      commentId = comment.id;
    });

    it('should get card comments', async () => {
      const comments = await client.callTool('get_card_comments', { cardId });
      expect(Array.isArray(comments)).toBe(true);
      expect(comments.length).toBeGreaterThan(0);
    });

    it('should delete a comment', async () => {
      const result = await client.callTool('delete_comment', { commentId });
      expect(result).toBe('success');
    });
  });

  describe('copy_card', () => {
    let sourceCardId: string;

    beforeAll(async () => {
      const card = await client.callTool('add_card_to_list', {
        listId: testListId,
        name: 'Copy Source Card',
        description: 'This card will be copied',
      });
      sourceCardId = card.id;
      createdCardIds.push(sourceCardId);
    });

    it('should copy a card with all properties', async () => {
      const copied = await client.callTool('copy_card', {
        sourceCardId,
        listId: testListId,
        keepFromSource: 'all',
      });
      expect(copied).toHaveProperty('id');
      expect(copied.id).not.toBe(sourceCardId);
      expect(copied.name).toBe('Copy Source Card');
      createdCardIds.push(copied.id);
    });

    it('should copy a card with custom name', async () => {
      const copied = await client.callTool('copy_card', {
        sourceCardId,
        listId: testListId,
        name: 'Renamed Copy',
      });
      expect(copied.name).toBe('Renamed Copy');
      createdCardIds.push(copied.id);
    });

    it('should copy with selective keepFromSource', async () => {
      const copied = await client.callTool('copy_card', {
        sourceCardId,
        listId: testListId,
        keepFromSource: 'due,labels',
      });
      expect(copied).toHaveProperty('id');
      createdCardIds.push(copied.id);
    });
  });

  describe('copy_checklist', () => {
    let sourceCardId: string;
    let destCardId: string;
    let checklistId: string;

    beforeAll(async () => {
      const [srcCard, dstCard] = await Promise.all([
        client.callTool('add_card_to_list', {
          listId: testListId,
          name: 'Checklist Copy Source',
        }),
        client.callTool('add_card_to_list', {
          listId: testListId,
          name: 'Checklist Copy Dest',
        }),
      ]);
      sourceCardId = srcCard.id;
      destCardId = dstCard.id;
      createdCardIds.push(sourceCardId, destCardId);

      // Create checklist with items on source
      const cl = await client.callTool('create_checklist', {
        cardId: sourceCardId,
        name: 'Source Checklist',
      });
      checklistId = cl.id;

      await client.callTool('add_checklist_item', {
        cardId: sourceCardId,
        checkListName: 'Source Checklist',
        text: 'Item A',
      });
      await client.callTool('add_checklist_item', {
        cardId: sourceCardId,
        checkListName: 'Source Checklist',
        text: 'Item B',
      });
    });

    it('should copy checklist to another card', async () => {
      const copied = await client.callTool('copy_checklist', {
        sourceChecklistId: checklistId,
        cardId: destCardId,
      });
      expect(copied).toHaveProperty('id');
      expect(copied.id).not.toBe(checklistId);
      expect(copied.name).toBe('Source Checklist');
      expect(copied.checkItems).toHaveLength(2);
    });

    it('should copy checklist with custom name', async () => {
      const copied = await client.callTool('copy_checklist', {
        sourceChecklistId: checklistId,
        cardId: destCardId,
        name: 'Renamed Checklist',
      });
      expect(copied.name).toBe('Renamed Checklist');
    });
  });

  describe('add_cards_to_list', () => {
    it('should create multiple cards', async () => {
      const result = await client.callTool('add_cards_to_list', {
        listId: testListId,
        cards: [
          { name: 'Batch 1', description: 'First' },
          { name: 'Batch 2', description: 'Second' },
          { name: 'Batch 3' },
        ],
      });
      expect(result.created).toHaveLength(3);
      expect(result.stopped).toBeUndefined();
      expect(result.created[0].name).toBe('Batch 1');
      expect(result.created[1].name).toBe('Batch 2');
      expect(result.created[2].name).toBe('Batch 3');
      result.created.forEach((c: any) => createdCardIds.push(c.id));
    });

    it('should handle single card in batch', async () => {
      const result = await client.callTool('add_cards_to_list', {
        listId: testListId,
        cards: [{ name: 'Single Batch Card' }],
      });
      expect(result.created).toHaveLength(1);
      createdCardIds.push(result.created[0].id);
    });
  });

  describe('Label operations', () => {
    let labelId: string;

    it('should get board labels', async () => {
      const labels = await client.callTool('get_board_labels', { boardId: TEST_BOARD_ID });
      expect(Array.isArray(labels)).toBe(true);
    });

    it('should create a label', async () => {
      const label = await client.callTool('create_label', {
        boardId: TEST_BOARD_ID,
        name: 'Smoke Test Label',
        color: 'green',
      });
      expect(label).toHaveProperty('id');
      expect(label.name).toBe('Smoke Test Label');
      labelId = label.id;
    });

    it('should update a label', async () => {
      const updated = await client.callTool('update_label', {
        labelId,
        name: 'Updated Label',
        color: 'blue',
      });
      expect(updated.name).toBe('Updated Label');
    });

    it('should delete a label', async () => {
      const result = await client.callTool('delete_label', { labelId });
      expect(result).toBe('Label deleted successfully');
    });
  });

  // The features this fork added. Before these tests they were tested offline only.

  describe('Card numbers', () => {
    let card: any;

    beforeAll(async () => {
      card = await client.callTool('add_card_to_list', { listId: testListId, name: 'Numbered' });
      createdCardIds.push(card.id);
    });

    it('opens, changes and archives a card by its number on the board', async () => {
      const found = await client.callTool('get_card', {
        cardNumber: card.idShort,
        boardId: TEST_BOARD_ID,
      });
      expect(found.id).toBe(card.id);

      const renamed = await client.callTool('update_card_details', {
        cardNumber: card.idShort,
        boardId: TEST_BOARD_ID,
        name: 'Numbered and renamed',
      });
      expect(renamed.name).toBe('Numbered and renamed');

      const archived = await client.callTool('archive_card', {
        cardNumber: card.idShort,
        boardId: TEST_BOARD_ID,
      });
      expect(archived.closed).toBe(true);
    });

    it('accepts the board short link as boardId', async () => {
      const board = (await client.callTool('list_boards')).find((b: any) => b.id === TEST_BOARD_ID);
      const found = await client.callTool('get_card', {
        cardId: card.id,
        boardId: board.shortLink,
      });
      expect(found.id).toBe(card.id);
    });

    it.skipIf(!OTHER_BOARD_ID)('refuses a card id with the wrong boardId', async () => {
      const result = await client.callToolResult('get_card', {
        cardId: card.id,
        boardId: OTHER_BOARD_ID,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(`is on board ${TEST_BOARD_ID}`);
    });
  });

  describe.skipIf(!OTHER_BOARD_ID)('move_card across boards', () => {
    it('moves a card to the board of the target list, and refuses a wrong boardId', async () => {
      const card = await client.callTool('add_card_to_list', { listId: testListId, name: 'Mover' });
      createdCardIds.push(card.id);
      const [otherList] = await client.callTool('get_lists', { boardId: OTHER_BOARD_ID });

      const moved = await client.callTool('move_card', { cardId: card.id, listId: otherList.id });
      expect(moved.idBoard).toBe(OTHER_BOARD_ID);
      expect(moved.idList).toBe(otherList.id);
      // Trello gives a card a new number on each board it moves to.
      expect(moved.idShort).not.toBe(card.idShort);

      const refused = await client.callToolResult('move_card', {
        cardId: card.id,
        listId: testListId,
        boardId: OTHER_BOARD_ID,
      });
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain('Nothing was done');

      const back = await client.callTool('move_card', {
        cardId: card.id,
        listId: testListId,
        boardId: TEST_BOARD_ID,
      });
      expect(back.idBoard).toBe(TEST_BOARD_ID);
    });
  });

  describe('Comments in the body', () => {
    it('keeps a long comment whole, changes it, and shows it in the markdown card', async () => {
      const card = await client.callTool('add_card_to_list', { listId: testListId, name: 'Talk' });
      createdCardIds.push(card.id);
      const text = 'A comment longer than a URL can carry. '.repeat(150);

      const added = await client.callTool('add_comment', { cardId: card.id, text });
      expect(added.text).toBe(text);

      expect(await client.callTool('update_comment', { commentId: added.id, text: 'Edited' })).toBe(
        'success'
      );
      const [comment] = await client.callTool('get_card_comments', { cardId: card.id });
      expect(comment.text).toBe('Edited');
      expect(comment.member.username).toBeTruthy();

      const markdown = await client.callTool('get_card', {
        cardId: card.id,
        includeMarkdown: true,
      });
      expect(markdown).toContain('## Comments (1)');
      expect(markdown).toContain('Edited');
    });
  });

  describe('One label and one member at a time', () => {
    it('adds and removes one label, and leaves the others', async () => {
      const [keep, change] = await Promise.all([
        client.callTool('create_label', { name: 'smoke-keep', color: 'green' }),
        client.callTool('create_label', { name: 'smoke-change', color: 'blue' }),
      ]);
      const card = await client.callTool('add_card_to_list', {
        listId: testListId,
        name: 'Labeled',
        labels: [keep.id],
      });
      createdCardIds.push(card.id);
      try {
        const added = await client.callTool('add_label_to_card', {
          cardId: card.id,
          labelId: change.id,
        });
        expect(added.idLabels.sort()).toEqual([keep.id, change.id].sort());

        await client.callTool('remove_label_from_card', { cardId: card.id, labelId: change.id });
        const after = await client.callTool('get_card', { cardId: card.id });
        expect(after.labels.map((label: any) => label.id)).toEqual([keep.id]);
      } finally {
        await client.callTool('delete_label', { labelId: keep.id });
        await client.callTool('delete_label', { labelId: change.id });
      }
    });

    it('returns the members on the card after an assignment and a removal', async () => {
      const card = await client.callTool('add_card_to_list', { listId: testListId, name: 'Owned' });
      createdCardIds.push(card.id);
      const [me] = await client.callTool('get_board_members', { boardId: TEST_BOARD_ID });

      const assigned = await client.callTool('assign_member_to_card', {
        cardId: card.id,
        memberId: me.id,
      });
      expect(assigned).toEqual([{ id: me.id, username: me.username, fullName: me.fullName }]);

      const removed = await client.callTool('remove_member_from_card', {
        cardId: card.id,
        memberId: me.id,
      });
      expect(removed).toEqual([]);
    });
  });

  describe('Checklist with items and acceptance criteria', () => {
    it('creates the items in order, and reads and completes the criteria', async () => {
      const card = await client.callTool('add_card_to_list', {
        listId: testListId,
        name: 'Criteria',
      });
      createdCardIds.push(card.id);

      const checklist = await client.callTool('create_checklist', {
        cardId: card.id,
        name: 'Acceptance Criteria',
        items: ['First', 'Second'],
      });
      expect(checklist.checkItems.map((item: any) => item.name)).toEqual(['First', 'Second']);

      const before = await client.callTool('get_acceptance_criteria', { cardId: card.id });
      expect(before.found).toBe(true);
      expect(before.unmet).toHaveLength(2);

      await client.callTool('update_checklist_item', {
        cardId: card.id,
        checkItemId: checklist.checkItems[0].id,
        state: 'complete',
      });
      const after = await client.callTool('get_acceptance_criteria', { cardId: card.id });
      expect(after.percentComplete).toBe(50);
      expect(after.unmet.map((item: any) => item.text)).toEqual(['Second']);
    });
  });

  describe('Attachments', () => {
    let files: McpTestClient;
    let root: string;
    let cardId: string;

    beforeAll(async () => {
      root = mkdtempSync(path.join(os.tmpdir(), 'trello-mcp-attach-'));
      writeFileSync(path.join(root, 'notes.txt'), 'Uploaded by the smoke suite.');
      files = new McpTestClient({ TRELLO_ATTACH_ROOT: root });
      await files.initialize();
      const card = await files.callTool('add_card_to_list', { listId: testListId, name: 'Files' });
      cardId = card.id;
      createdCardIds.push(cardId);
    });

    afterAll(() => {
      files?.close();
      rmSync(root, { recursive: true, force: true });
    });

    it('stores a link, and refuses to download it', async () => {
      const link = await files.callTool('attach_to_card', {
        cardId,
        source: 'https://example.com/spec.pdf',
        name: 'spec',
      });
      expect(link).toMatchObject({ name: 'spec.pdf', isUpload: false });

      const refused = await files.callToolResult('download_attachment', {
        cardId,
        attachmentId: link.id,
      });
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain('is a link to https://example.com/spec.pdf');
    });

    it('uploads inline data and downloads it as an image', async () => {
      // A PNG of one pixel.
      const pixel =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const upload = await files.callTool('attach_to_card', {
        cardId,
        source: `data:image/png;base64,${pixel}`,
        name: 'pixel',
      });
      expect(upload).toMatchObject({ name: 'pixel.png', isUpload: true, mimeType: 'image/png' });

      const download = await files.callToolResult('download_attachment', {
        cardId,
        attachmentId: upload.id,
      });
      expect(download.content[0]).toEqual({ type: 'image', data: pixel, mimeType: 'image/png' });
    });

    it('uploads a file from TRELLO_ATTACH_ROOT and downloads the same bytes', async () => {
      const upload = await files.callTool('attach_to_card', {
        cardId,
        source: `file://${path.join(root, 'notes.txt')}`,
      });
      expect(upload).toMatchObject({ name: 'notes.txt', isUpload: true, mimeType: 'text/plain' });

      const download = await files.callTool('download_attachment', {
        cardId,
        attachmentId: upload.id,
      });
      expect(Buffer.from(download.data, 'base64').toString()).toBe('Uploaded by the smoke suite.');
    });
  });

  describe('Custom fields', () => {
    let fieldId: string;

    beforeAll(async () => {
      // No tool makes a custom field, so the test makes one straight on Trello.
      const field = await trelloApi('POST', '/customFields', {
        idModel: TEST_BOARD_ID,
        modelType: 'board',
        name: 'Smoke size',
        type: 'text',
        pos: 'bottom',
      });
      fieldId = field.id;
    });

    afterAll(async () => {
      const fields = await trelloApi('GET', `/boards/${TEST_BOARD_ID}/customFields`);
      for (const field of fields.filter((each: any) => each.name === 'Smoke size')) {
        await trelloApi('DELETE', `/customFields/${field.id}`);
      }
    });

    it('lists, sets and clears a text field', async () => {
      const fields = await client.callTool('get_board_custom_fields', { boardId: TEST_BOARD_ID });
      expect(fields.map((field: any) => field.id)).toContain(fieldId);

      const card = await client.callTool('add_card_to_list', { listId: testListId, name: 'Sized' });
      createdCardIds.push(card.id);
      await client.callTool('update_card_custom_field', {
        cardId: card.id,
        customFieldId: fieldId,
        type: 'text',
        value: 'L',
      });
      const sized = await client.callTool('get_card', { cardId: card.id });
      expect(sized.customFieldItems).toEqual([
        { idCustomField: fieldId, value: { text: 'L' }, idValue: null },
      ]);

      const cleared = await client.callTool('update_card_custom_field', {
        cardId: card.id,
        customFieldId: fieldId,
        type: 'clear',
      });
      expect(cleared.value).toBeNull();
    });
  });

  describe.skipIf(!WORKSPACE_ID || !REFUSED_BOARD_ID || !REFUSED_WORKSPACE_ID)(
    'Workspace guard',
    () => {
      let guarded: McpTestClient;

      beforeAll(async () => {
        guarded = new McpTestClient({ TRELLO_ALLOWED_WORKSPACES: WORKSPACE_ID! });
        await guarded.initialize();
      });

      afterAll(() => guarded?.close());

      it('lists only the allowed workspace and its boards', async () => {
        const workspaces = await guarded.callTool('list_workspaces');
        expect(workspaces.map((workspace: any) => workspace.id)).toEqual([WORKSPACE_ID]);
        const boards = await guarded.callTool('list_boards');
        expect(boards.map((board: any) => board.id)).toContain(TEST_BOARD_ID);
        expect(boards.map((board: any) => board.id)).not.toContain(REFUSED_BOARD_ID);
      });

      it('lets a call on an allowed board through', async () => {
        const lists = await guarded.callTool('get_lists', { boardId: TEST_BOARD_ID });
        expect(lists.length).toBeGreaterThan(0);
      });

      it.each([
        ['get_lists', () => ({ boardId: REFUSED_BOARD_ID })],
        ['search_cards', () => ({ query: 'smoke', boardId: REFUSED_BOARD_ID })],
        ['list_boards_in_workspace', () => ({ workspaceId: REFUSED_WORKSPACE_ID })],
        ['set_active_workspace', () => ({ workspaceId: REFUSED_WORKSPACE_ID })],
      ])('refuses %s outside the allowed workspace', async (tool, args) => {
        const result = await guarded.callToolResult(tool, args());
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/workspace guard|is not allowed/);
      });

      it('refuses to move a card to a board outside the allowed workspace', async () => {
        const card = await guarded.callTool('add_card_to_list', {
          listId: testListId,
          name: 'Guarded',
        });
        createdCardIds.push(card.id);
        const [refusedList] = await client.callTool('get_lists', { boardId: REFUSED_BOARD_ID });

        const result = await guarded.callToolResult('move_card', {
          cardId: card.id,
          listId: refusedList.id,
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Refused by the workspace guard');
        const after = await client.callTool('get_card', { cardId: card.id });
        expect(after.idBoard).toBe(TEST_BOARD_ID);
      });
    }
  );

  // Last, so that the rest of the suite runs while Trello indexes the search target.
  describe('search_cards', () => {
    it(
      'finds a card by a word in its name once Trello has indexed it',
      { timeout: 330_000 },
      async () => {
        // The delay was 2 to 4 minutes when this test was written.
        let found: any[] = [];
        const deadline = Date.now() + 300_000;
        while (Date.now() < deadline) {
          found = await client.callTool('search_cards', {
            query: searchWord,
            boardId: TEST_BOARD_ID,
          });
          if (found.length > 0) break;
          await new Promise(resolve => setTimeout(resolve, 10_000));
        }
        expect(found.map(match => match.id)).toEqual([searchTarget.id]);
        expect(found[0]).toMatchObject({ idShort: searchTarget.idShort, idBoard: TEST_BOARD_ID });
      }
    );
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- replies are free-form JSON, checked field by field with expect */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { readFileSync } from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import { TrelloClient } from '../../src/trello/client.js';

// set_active_board and set_active_workspace save to the home folder. Reads stay real.
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}) };
});

// Every tool goes through the real server, the real client and the real reply shapers. Only
// Trello is fake: the axios adapter answers each route from the fixtures below.

const member = { id: 'm1', username: 'ada', fullName: 'Ada L', avatarUrl: 'https://t/a.png' };
const label = { id: 'x1', idBoard: 'b1', name: 'blocked', color: 'red', uses: 3 };
const checkItem = { id: 'i1', name: 'First', state: 'complete', pos: 1, idChecklist: 'k1' };
const checklist = {
  id: 'k1',
  name: 'Acceptance Criteria',
  idCard: 'c1',
  idBoard: 'b1',
  pos: 1,
  checkItems: [checkItem, { ...checkItem, id: 'i2', name: 'Second', state: 'incomplete', pos: 2 }],
};
const comment = {
  id: 'ac1',
  type: 'commentCard',
  date: '2026-09-23T11:00:00.000Z',
  idMemberCreator: 'm1',
  data: { text: 'Looks good to me.', card: { id: 'c1', name: 'Chat button', idShort: 53 } },
  memberCreator: member,
};
const attachment = {
  id: 'a1',
  name: 'shot.png',
  fileName: 'shot.png',
  url: 'https://trello.com/1/cards/c1/attachments/a1/download/shot.png',
  mimeType: 'image/png',
  bytes: 3,
  isUpload: true,
  date: '2026-09-23T10:00:00.000Z',
};
const card = {
  id: 'c1',
  idShort: 53,
  name: 'Chat button',
  desc: 'Add a chat button.',
  idBoard: 'b1',
  idList: 'l1',
  closed: false,
  due: null,
  dueComplete: false,
  dateLastActivity: '2026-09-23T10:00:00.000Z',
  url: 'https://trello.com/c/Ab/53-chat-button',
  shortUrl: 'https://trello.com/c/Ab',
  badges: { comments: 1, attachments: 1, checkItems: 2, checkItemsChecked: 1, votes: 0 },
  labels: [label],
  members: [member],
  checklists: [checklist],
  attachments: [attachment],
  actions: [comment],
  board: { id: 'b1', name: 'Product', url: 'https://trello.com/b/Bsh/product' },
  list: { id: 'l1', name: 'Doing' },
};
const list = { id: 'l1', name: 'Doing', closed: false, idBoard: 'b1', pos: 1, subscribed: false };
const board = {
  id: 'b1',
  name: 'Product',
  desc: '',
  closed: false,
  idOrganization: 'w1',
  shortLink: 'Bsh',
  url: 'https://trello.com/b/Bsh/product',
  prefs: { background: 'blue' },
};
const workspace = { id: 'w1', name: 'team', displayName: 'Team', desc: '', url: 'https://t/w' };

type Route = unknown | ((body: any, params: any) => unknown);

const routes: Record<string, Route> = {
  'GET /members/me/boards': [board],
  'GET /members/me/organizations': [workspace],
  'GET /members/me/cards': [card],
  'GET /boards/b1': board,
  'GET /boards/b1/actions': [comment],
  'GET /boards/b1/lists': [list],
  'GET /boards/b1/labels': [label],
  'GET /boards/b1/members': [member],
  'GET /boards/b1/cards/53': { id: 'c1' },
  'GET /boards/b1/customFields': [
    {
      id: 'f1',
      name: 'Size',
      type: 'text',
      idModel: 'b1',
      fieldGroup: 'g1',
      display: { cardFront: true },
    },
    {
      id: 'f2',
      name: 'Team',
      type: 'list',
      idModel: 'b1',
      fieldGroup: 'g2',
      display: { cardFront: true },
    },
  ],
  'GET /customFields/f2/options': [
    { id: 'o1', idCustomField: 'f2', value: { text: 'Core' }, color: 'none', pos: 1024 },
  ],
  'GET /organizations/w1': workspace,
  'GET /organizations/w1/boards': [board],
  'POST /boards': (body: any) => ({ ...board, id: 'b9', name: body.name }),
  'POST /lists': (body: any) => ({ ...list, id: 'l9', name: body.name }),
  'GET /lists/l1': { id: 'l1', idBoard: 'b1', board: { shortLink: 'Bsh' } },
  'GET /lists/l2': { id: 'l2', idBoard: 'b1', board: { shortLink: 'Bsh' } },
  'GET /lists/l1/cards': [card],
  'PUT /lists/l1': (body: any) => ({ ...list, ...body }),
  'PUT /lists/l1/pos': (body: any) => ({ ...list, pos: body.value }),
  'PUT /lists/l1/closed': { ...list, closed: true },
  'GET /search': { cards: [card] },
  'GET /cards/c1': card,
  'GET /cards/c1/actions': [comment],
  'POST /cards': (body: any) => ({ ...card, id: `new-${body.name}`, name: body.name }),
  'PUT /cards/c1': (body: any) => ({ ...card, ...body }),
  'POST /cards/c1/actions/comments': (body: any) => ({ ...comment, data: { text: body.text } }),
  'PUT /actions/ac1': { ...comment },
  'DELETE /actions/ac1': { _value: null },
  'POST /cards/c1/checklists': (body: any) => ({
    ...checklist,
    id: 'k9',
    name: body.name,
    checkItems: [],
  }),
  'POST /checklists/k9/checkItems': (body: any) => ({
    ...checkItem,
    id: `i-${body.name}`,
    name: body.name,
    state: 'incomplete',
  }),
  'POST /checklists/k1/checkItems': (body: any) => ({
    ...checkItem,
    id: 'i3',
    name: body.name,
    state: 'incomplete',
  }),
  'PUT /cards/c1/checkItem/i1': (body: any) => ({ ...checkItem, ...body }),
  'DELETE /cards/c1/checkItem/i1': {},
  'POST /checklists': (body: any) => ({ ...checklist, id: 'k8', idCard: body.idCard }),
  'POST /cards/c1/attachments': (body: any) => ({
    ...attachment,
    id: 'a9',
    name: body.name,
    isUpload: false,
  }),
  'GET /cards/c1/attachments/a1': attachment,
  'GET /cards/c1/attachments/a1/download/shot.png': Buffer.from('png'),
  'POST /boards/b1/labels': (body: any) => ({
    ...label,
    id: 'x9',
    name: body.name,
    color: body.color,
  }),
  'PUT /labels/x1': (body: any) => ({ ...label, ...body }),
  'DELETE /labels/x1': {},
  'POST /cards/c1/idLabels': ['x1', 'x2'],
  'DELETE /cards/c1/idLabels/x1': [],
  // Trello replies to a member change with the members on the card, and not with the card.
  'POST /cards/c1/idMembers': [member],
  'DELETE /cards/c1/idMembers/m1': [],
  'PUT /cards/c1/customField/f1/item': {
    id: 'cf1',
    idCustomField: 'f1',
    idModel: 'c1',
    modelType: 'card',
    value: { text: 'L' },
    idValue: null,
  },
};

type Sent = { method: string; path: string; params: any; body: any };
const sent: Sent[] = [];

async function fakeTrello(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const method = (config.method ?? 'get').toUpperCase();
  const route = (config.url ?? '').replace('https://api.trello.com/1', '').split('?')[0];
  const body =
    typeof config.data === 'string' && /^[[{]/.test(config.data)
      ? JSON.parse(config.data)
      : config.data;
  sent.push({ method, path: route, params: config.params, body });
  const answer = routes[`${method} ${route}`];
  const response: AxiosResponse = {
    data:
      answer === undefined
        ? { message: `the fake Trello has no route ${method} ${route}` }
        : typeof answer === 'function'
          ? answer(body, config.params)
          : answer,
    status: answer === undefined ? 404 : 200,
    statusText: '',
    headers: {},
    config,
  };
  if (response.status >= 400) {
    throw new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, {}, response);
  }
  return response;
}

// One call for each tool, with the inputs an agent would send.
const calls: Record<string, Record<string, unknown>> = {
  list_boards: {},
  set_active_board: { boardId: 'b1' },
  get_active_board_info: {},
  list_workspaces: {},
  set_active_workspace: { workspaceId: 'w1' },
  list_boards_in_workspace: { workspaceId: 'w1' },
  create_board: { name: 'New board', idOrganization: 'w1' },
  get_recent_activity: {},
  get_lists: {},
  add_list_to_board: { name: 'Review' },
  update_list: { listId: 'l1', name: 'Doing now' },
  update_list_position: { listId: 'l1', position: '1536' },
  archive_list: { listId: 'l1', boardId: 'b1' },
  watch_list: { listId: 'l1', subscribed: true },
  get_cards_by_list_id: { listId: 'l1' },
  get_my_cards: {},
  search_cards: { query: 'chat' },
  get_card: { cardNumber: 53 },
  get_card_history: { cardId: 'c1' },
  add_card_to_list: { listId: 'l1', name: 'Card', dueDate: '2026-10-01T12:00:00Z' },
  add_cards_to_list: { listId: 'l1', cards: [{ name: 'One' }, { name: 'Two' }] },
  update_card_details: { cardId: 'c1', name: 'Renamed' },
  move_card: { cardId: 'c1', listId: 'l2' },
  copy_card: { sourceCardId: 'c1', listId: 'l1' },
  archive_card: { cardNumber: 53 },
  watch_card: { cardId: 'c1', subscribed: true },
  get_card_comments: { cardId: 'c1' },
  add_comment: { cardId: 'c1', text: 'Done.' },
  update_comment: { commentId: 'ac1', text: 'Done now.' },
  delete_comment: { commentId: 'ac1' },
  create_checklist: { name: 'Acceptance Criteria', cardId: 'c1', items: ['One', 'Two'] },
  get_checklist_items: { name: 'Acceptance Criteria', cardId: 'c1' },
  get_checklist_by_name: { name: 'Acceptance Criteria', cardId: 'c1' },
  get_acceptance_criteria: { cardId: 'c1' },
  find_checklist_items_by_description: { description: 'sec', cardId: 'c1' },
  add_checklist_item: { text: 'Third', checkListName: 'Acceptance Criteria', cardId: 'c1' },
  update_checklist_item: { cardId: 'c1', checkItemId: 'i1', state: 'incomplete' },
  delete_checklist_item: { cardId: 'c1', checkItemId: 'i1' },
  copy_checklist: { sourceChecklistId: 'k1', cardId: 'c1' },
  attach_to_card: { cardId: 'c1', source: 'https://example.com/spec.pdf' },
  download_attachment: { cardId: 'c1', attachmentId: 'a1' },
  get_board_labels: {},
  create_label: { name: 'urgent', color: 'red' },
  update_label: { labelId: 'x1', name: 'blocked now' },
  delete_label: { labelId: 'x1' },
  add_label_to_card: { cardId: 'c1', labelId: 'x2' },
  remove_label_from_card: { cardId: 'c1', labelId: 'x1' },
  get_board_members: {},
  assign_member_to_card: { cardId: 'c1', memberId: 'm1' },
  remove_member_from_card: { cardId: 'c1', memberId: 'm1' },
  get_board_custom_fields: {},
  update_card_custom_field: { cardId: 'c1', customFieldId: 'f1', type: 'text', value: 'L' },
};

describe('server', () => {
  let mcp: Client;

  beforeAll(async () => {
    const trello = new TrelloClient({ apiKey: 'k', token: 't', boardId: 'b1' });
    (trello as unknown as { axiosInstance: AxiosInstance }).axiosInstance.defaults.adapter =
      fakeTrello;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await buildServer(trello).connect(serverSide);
    mcp = new Client({ name: 'server-test', version: '1.0.0' });
    await mcp.connect(clientSide);
  });

  afterAll(async () => {
    await mcp.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  async function call(name: string, args: Record<string, unknown> = calls[name]) {
    const result = (await mcp.callTool({ name, arguments: args })) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };
    return result;
  }

  async function reply(name: string, args?: Record<string, unknown>): Promise<any> {
    const result = await call(name, args);
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    const text = result.content[0].text ?? '';
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  describe('tool list', () => {
    it('has a call in this test for every tool, and 52 tools in all', async () => {
      const { tools } = await mcp.listTools();
      expect(tools.map(tool => tool.name).sort()).toEqual(Object.keys(calls).sort());
      expect(tools).toHaveLength(52);
    });

    it('matches tools.md, with each required and each optional input', async () => {
      const doc = readFileSync(path.resolve('skills/trello-mcp/references/tools.md'), 'utf8');
      const documented = new Map<string, { required: string[]; optional: string[] }>();
      // A tool row has four columns: the tool, the required inputs, the optional ones, the result.
      const rows = doc
        .split('\n')
        .filter(row => row.startsWith('| **`'))
        .map(row => row.split('|').slice(1, -1))
        .filter(cells => cells.length === 4);
      for (const [name, required, optional] of rows) {
        const names = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map(match => match[1]);
        // "`cardId` or `cardNumber`" is a choice of one, so the schema has both as optional.
        const choice = required.includes(' or ');
        documented.set(names(name)[0], {
          required: choice ? [] : names(required),
          optional: [...(choice ? names(required) : []), ...names(optional)].sort(),
        });
      }

      const { tools } = await mcp.listTools();
      const actual = new Map(
        tools.map(tool => {
          const required = (tool.inputSchema.required ?? []) as string[];
          const optional = Object.keys(tool.inputSchema.properties ?? {})
            .filter(input => !required.includes(input))
            .sort();
          return [tool.name, { required, optional }];
        })
      );
      expect(Object.fromEntries(documented)).toEqual(Object.fromEntries(actual));
    });
  });

  describe('every tool', () => {
    it.each(Object.keys(calls))('%s replies without an error', async name => {
      const result = await call(name);
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(result.content.length).toBeGreaterThan(0);
    });
  });

  describe('replies', () => {
    it('trims a board to the fields that an agent reads', async () => {
      const [first] = await reply('list_boards');
      expect(first).toEqual({
        id: 'b1',
        name: 'Product',
        desc: '',
        closed: false,
        idOrganization: 'w1',
        shortLink: 'Bsh',
        url: 'https://trello.com/b/Bsh/product',
      });
    });

    it('gives the full Trello reply with raw', async () => {
      const [first] = await reply('list_boards', { raw: true });
      expect(first.prefs).toEqual({ background: 'blue' });
    });

    it('trims the members that assign_member_to_card and remove_member_from_card return', async () => {
      expect(await reply('assign_member_to_card')).toEqual([
        { id: 'm1', username: 'ada', fullName: 'Ada L' },
      ]);
      expect(await reply('remove_member_from_card')).toEqual([]);
      expect(sent.map(request => `${request.method} ${request.path}`)).toEqual([
        'POST /cards/c1/idMembers',
        'DELETE /cards/c1/idMembers/m1',
      ]);
    });

    it('trims a listed card, and keeps every field that fields asks for', async () => {
      const [trimmed] = await reply('get_cards_by_list_id', { listId: 'l1' });
      expect(trimmed.badges).toBeUndefined();

      const [asked] = await reply('get_cards_by_list_id', { listId: 'l1', fields: 'name,badges' });
      expect(asked.badges).toEqual(card.badges);
      expect(sent[1].params.fields).toBe('name,badges');
    });

    it('opens a card by its number on the active board', async () => {
      const found = await reply('get_card', { cardNumber: 53 });
      expect(found.id).toBe('c1');
      expect(found.comments).toEqual([
        {
          id: 'ac1',
          date: '2026-09-23T11:00:00.000Z',
          text: 'Looks good to me.',
          member: { id: 'm1', username: 'ada', fullName: 'Ada L' },
        },
      ]);
      expect(sent.map(request => request.path)).toEqual(['/boards/b1/cards/53', '/cards/c1']);
    });

    it('gives the card as markdown with includeMarkdown, also when raw is set', async () => {
      const markdown = await reply('get_card', { cardId: 'c1', includeMarkdown: true, raw: true });
      expect(markdown.startsWith('# Chat button\n')).toBe(true);
    });

    it('sends a comment in the body, never in the query', async () => {
      await reply('add_comment');
      expect(sent[0].body).toEqual({ text: 'Done.' });
      expect(sent[0].params.text).toBeUndefined();
    });

    it('moves a card to the board of the target list', async () => {
      await reply('move_card');
      expect(sent.map(request => `${request.method} ${request.path}`)).toEqual([
        'GET /lists/l2',
        'PUT /cards/c1',
      ]);
      expect(sent[1].body).toEqual({ idList: 'l2', idBoard: 'b1' });
    });

    it('creates a checklist with its items in order', async () => {
      const made = await reply('create_checklist');
      expect(made.checkItems.map((item: { name: string }) => item.name)).toEqual(['One', 'Two']);
    });

    it('returns an image attachment as MCP image content', async () => {
      const result = await call('download_attachment');
      expect(result.content[0]).toEqual({
        type: 'image',
        data: Buffer.from('png').toString('base64'),
        mimeType: 'image/png',
      });
    });

    it('trims the custom fields of a board, and keeps the options of a list field', async () => {
      expect(await reply('get_board_custom_fields')).toEqual([
        { id: 'f1', name: 'Size', type: 'text' },
        { id: 'f2', name: 'Team', type: 'list', options: [{ id: 'o1', value: { text: 'Core' } }] },
      ]);
      const [full] = await reply('get_board_custom_fields', { raw: true });
      expect(full.fieldGroup).toBe('g1');
    });

    it('trims the custom field value that update_card_custom_field returns', async () => {
      expect(await reply('update_card_custom_field')).toEqual({
        idCustomField: 'f1',
        idModel: 'c1',
        value: { text: 'L' },
        idValue: null,
      });
    });

    it('reports a batch as the cards it created', async () => {
      const result = await reply('add_cards_to_list');
      expect(result.created.map((made: { name: string }) => made.name)).toEqual(['One', 'Two']);
      expect(result.stopped).toBeUndefined();
    });
  });

  describe('refusals', () => {
    it('refuses a date that is not ISO 8601 before any request', async () => {
      const result = await call('add_card_to_list', {
        listId: 'l1',
        name: 'Card',
        dueDate: 'next Friday',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('dueDate "next Friday" is not an ISO 8601 date');
      expect(sent).toHaveLength(0);
    });

    it("gives Trello's reason when Trello refuses a call", async () => {
      const result = await call('get_card', { cardId: 'missing' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Trello returned 404: the fake Trello has no route GET /cards/missing'
      );
    });
  });
});

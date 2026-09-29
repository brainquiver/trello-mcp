import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { TrelloClient } from '../../../src/trello/client.js';

// Shared mock instance that axios.create will return
const mockAxiosInstance = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  request: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance),
    isAxiosError: vi.fn(
      (error: unknown) => (error as { isAxiosError?: boolean })?.isAxiosError === true
    ),
  },
}));

// Mock rate-limiter
vi.mock('../../../src/trello/rate-limiter.js', () => ({
  createTrelloRateLimiters: () => ({
    apiKeyLimiter: { canMakeRequest: () => true, waitForAvailableToken: async () => {} },
    tokenLimiter: { canMakeRequest: () => true, waitForAvailableToken: async () => {} },
    canMakeRequest: () => true,
    waitForAvailableToken: async () => {},
  }),
}));

// Mock fs/promises for config loading
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }),
  writeFile: vi.fn(async () => {}),
  access: vi.fn(async () => {}),
}));

function createClient(overrides?: {
  boardId?: string;
  defaultBoardId?: string;
  allowedWorkspaceIds?: string[];
  descriptionLimit?: number;
  maxDownloadMb?: number;
}) {
  return new TrelloClient({ apiKey: 'test-key', token: 'test-token', ...overrides });
}

describe('TrelloClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps queued Once replies, so a failed test would leak them into the next.
    for (const method of ['get', 'post', 'put', 'delete', 'request'] as const) {
      mockAxiosInstance[method].mockReset();
    }
  });

  describe('constructor', () => {
    it('should create axios instance with correct base URL and auth', () => {
      createClient();
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.trello.com/1',
          params: { key: 'test-key', token: 'test-token' },
        })
      );
    });

    it('should not enable workspace restrictions when allowed workspaces are unset or empty', () => {
      expect(createClient().hasWorkspaceRestriction).toBe(false);
      expect(createClient({ allowedWorkspaceIds: [] }).hasWorkspaceRestriction).toBe(false);
    });
  });

  describe('workspace restriction', () => {
    it('should reject access to a non-allowed workspace before making a request', async () => {
      const client = createClient({ allowedWorkspaceIds: ['allowed-workspace'] });

      await expect(client.listBoardsInWorkspace('blocked-workspace')).rejects.toThrow(
        "Access to workspace 'blocked-workspace' is not allowed"
      );
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });
  });

  describe('listBoards', () => {
    it('should fetch user boards', async () => {
      const boards = [{ id: 'b1', name: 'Board 1' }];
      mockAxiosInstance.get.mockResolvedValue({ data: boards });

      const client = createClient();
      const result = await client.listBoards();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/members/me/boards');
      expect(result).toEqual(boards);
    });
  });

  describe('getBoardById', () => {
    it('should fetch a specific board', async () => {
      const board = { id: 'b1', name: 'Test Board' };
      mockAxiosInstance.get.mockResolvedValue({ data: board });

      const client = createClient();
      const result = await client.getBoardById('b1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/boards/b1');
      expect(result).toEqual(board);
    });
  });

  describe('getLists', () => {
    it('should use provided boardId', async () => {
      const lists = [{ id: 'l1', name: 'List 1' }];
      mockAxiosInstance.get.mockResolvedValue({ data: lists });

      const client = createClient();
      const result = await client.getLists('board123');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/boards/board123/lists');
      expect(result).toEqual(lists);
    });

    it('should fall back to active board', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      const client = createClient({ boardId: 'active-board' });
      await client.getLists();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/boards/active-board/lists');
    });

    it('should throw when no board ID available', async () => {
      const client = createClient();
      await expect(client.getLists()).rejects.toThrow(
        'boardId is required when no default board is configured'
      );
    });
  });

  describe('addCard', () => {
    it('should create card with all parameters', async () => {
      const card = { id: 'c1', name: 'New Card' };
      mockAxiosInstance.post.mockResolvedValue({ data: card });

      const client = createClient();
      const result = await client.addCard(undefined, {
        listId: 'l1',
        name: 'New Card',
        description: 'A description',
        dueDate: '2024-12-31T00:00:00Z',
        dueReminder: 0,
        start: '2024-12-01',
        labels: ['label1'],
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/cards', {
        idList: 'l1',
        name: 'New Card',
        desc: 'A description',
        due: '2024-12-31T00:00:00Z',
        dueReminder: 0,
        start: '2024-12-01',
        idLabels: ['label1'],
      });
      expect(result).toEqual(card);
    });

    it('should create card with minimal parameters', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'c1' } });

      const client = createClient();
      await client.addCard(undefined, { listId: 'l1', name: 'Card' });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/cards', {
        idList: 'l1',
        name: 'Card',
        desc: undefined,
        due: undefined,
        dueReminder: undefined,
        start: undefined,
        idLabels: undefined,
      });
    });
  });

  describe('updateCard', () => {
    it('should update card fields', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'c1', name: 'Updated' } });

      const client = createClient();
      await client.updateCard(undefined, {
        cardId: 'c1',
        name: 'Updated',
        dueReminder: null,
        dueComplete: true,
      });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/c1', {
        name: 'Updated',
        desc: undefined,
        due: undefined,
        dueReminder: null,
        start: undefined,
        dueComplete: true,
        idLabels: undefined,
      });
    });

    it('should pass numeric due reminder value', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'c1' } });

      const client = createClient();
      await client.updateCard(undefined, {
        cardId: 'c1',
        dueReminder: 60,
      });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/c1', {
        name: undefined,
        desc: undefined,
        due: undefined,
        dueReminder: 60,
        start: undefined,
        dueComplete: undefined,
        idLabels: undefined,
      });
    });
  });

  describe('date checks', () => {
    it('refuses a card with a due date that is not ISO 8601 and sends nothing', async () => {
      const client = createClient();

      await expect(
        client.addCard(undefined, { listId: 'l1', name: 'Card', dueDate: 'next Friday' })
      ).rejects.toThrow('dueDate "next Friday" is not an ISO 8601 date');
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('refuses an update with a start date that is not ISO 8601 and sends nothing', async () => {
      const client = createClient();

      await expect(
        client.updateCard(undefined, { cardId: 'c1', start: '01/10/2026' })
      ).rejects.toThrow('start "01/10/2026" is not an ISO 8601 date');
      expect(mockAxiosInstance.put).not.toHaveBeenCalled();
    });

    it('refuses a checklist item due date that is not ISO 8601, and lets null clear it', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'ci1' } });
      const client = createClient();

      await expect(client.updateChecklistItem('c1', 'ci1', { due: 'tomorrow' })).rejects.toThrow(
        'due "tomorrow" is not an ISO 8601 date'
      );
      expect(mockAxiosInstance.put).not.toHaveBeenCalled();

      await client.updateChecklistItem('c1', 'ci1', { due: null });
      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/c1/checkItem/ci1', { due: null });
    });
  });

  describe('archiveCard', () => {
    it('should set closed to true', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'c1', closed: true } });

      const client = createClient();
      await client.archiveCard(undefined, 'c1');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/c1', { closed: true });
    });
  });

  describe('moveCard', () => {
    const listOn = (idBoard: string) => ({ data: { idBoard, board: { shortLink: 'AbCd1234' } } });

    it("should move the card to the target list's own board, looked up from the list", async () => {
      mockAxiosInstance.get.mockResolvedValue(listOn('b2'));
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'c1' } });

      const client = createClient({ defaultBoardId: 'b1' });
      await client.moveCard(undefined, 'c1', 'l2');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/lists/l2', expect.anything());
      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/c1', {
        idList: 'l2',
        idBoard: 'b2',
      });
    });

    it('should never send the default board with a list on another board', async () => {
      mockAxiosInstance.get.mockResolvedValue(listOn('b2'));
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'c1' } });

      const client = createClient({ defaultBoardId: 'b1' });
      await client.moveCard(undefined, 'c1', 'l2', 'top');

      const body = mockAxiosInstance.put.mock.calls[0][1];
      expect(body.idBoard).not.toBe('b1');
      expect(body.pos).toBe('top');
    });

    it('should accept a boardId the list is on, by id or by short link', async () => {
      mockAxiosInstance.get.mockResolvedValue(listOn('b2'));
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'c1' } });

      const client = createClient();
      await client.moveCard('b2', 'c1', 'l2');
      await client.moveCard('AbCd1234', 'c1', 'l2');

      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.put.mock.calls[1][1].idBoard).toBe('b2');
    });

    it('should refuse a boardId the list is not on, and move nothing', async () => {
      mockAxiosInstance.get.mockResolvedValue(listOn('b2'));

      const client = createClient();
      await expect(client.moveCard('b9', 'c1', 'l2')).rejects.toThrow(
        'The list l2 is on board b2, not on board b9. Nothing was done.'
      );
      expect(mockAxiosInstance.put).not.toHaveBeenCalled();
    });
  });

  describe('addList', () => {
    it('should create list on board', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'l1', name: 'New List' } });

      const client = createClient({ boardId: 'b1' });
      await client.addList(undefined, 'New List');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/lists', {
        name: 'New List',
        idBoard: 'b1',
      });
    });

    it('should throw when no board ID available', async () => {
      const client = createClient();
      await expect(client.addList(undefined, 'List')).rejects.toThrow('boardId is required');
    });
  });

  describe('archiveList', () => {
    it('should set list closed value to true', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'l1' } });

      const client = createClient();
      await client.archiveList(undefined, 'l1');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/lists/l1/closed', { value: true });
    });
  });

  describe('updateList', () => {
    it('should update list metadata without position fields', async () => {
      const list = { id: 'l1', name: 'Updated List' };
      mockAxiosInstance.put.mockResolvedValue({ data: list });

      const client = createClient();
      const result = await client.updateList('l1', {
        name: 'Updated List',
        closed: false,
        subscribed: true,
        idBoard: 'b2',
      });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/lists/l1', {
        name: 'Updated List',
        closed: false,
        subscribed: true,
        idBoard: 'b2',
      });
      expect(result).toEqual(list);
    });
  });

  describe('activity subscriptions', () => {
    it('watchCard should update the card subscription', async () => {
      const card = { id: 'c1', subscribed: true };
      mockAxiosInstance.put.mockResolvedValue({ data: card });

      const result = await createClient().watchCard('c1', true);

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/c1', { subscribed: true });
      expect(result).toEqual(card);
    });

    it('watchList should update the list subscription', async () => {
      const list = { id: 'l1', subscribed: false };
      mockAxiosInstance.put.mockResolvedValue({ data: list });

      const result = await createClient().watchList('l1', false);

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/lists/l1', { subscribed: false });
      expect(result).toEqual(list);
    });
  });

  describe('getMyCards', () => {
    it('should fetch current user cards', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      const client = createClient();
      await client.getMyCards();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/members/me/cards');
    });
  });

  describe('Comments', () => {
    it('addCommentToCard should send the text in the body, not the URL', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'comment1' } });

      const client = createClient();
      await client.addCommentToCard('c1', 'Hello World & Test');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/cards/c1/actions/comments', {
        text: 'Hello World & Test',
      });
    });

    it('addCommentToCard should take a comment longer than a URL can carry', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'comment1' } });

      const client = createClient();
      const long = 'x'.repeat(16000);
      await client.addCommentToCard('c1', long);

      const [url, body] = mockAxiosInstance.post.mock.calls[0];
      expect(url.length).toBeLessThan(40);
      expect(body.text).toBe(long);
    });

    it('updateCommentOnCard should send the text in the body and return true on success', async () => {
      mockAxiosInstance.put.mockResolvedValue({ status: 200, data: {} });

      const client = createClient();
      const result = await client.updateCommentOnCard('comment1', 'Updated text');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/actions/comment1', {
        text: 'Updated text',
      });
      expect(result).toBe(true);
    });

    it('deleteCommentFromCard should call delete', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ status: 200 });

      const client = createClient();
      await client.deleteCommentFromCard('comment1');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/actions/comment1');
    });

    it('getCardComments should fetch with filter and limit', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      const client = createClient();
      await client.getCardComments('c1', 50);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/cards/c1/actions', {
        params: { filter: 'commentCard', limit: 50 },
      });
    });
  });

  describe('Checklists', () => {
    it('createChecklist should post to card', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'cl1', name: 'Checklist' } });

      const client = createClient();
      await client.createChecklist('My Checklist', 'c1');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/cards/c1/checklists', {
        name: 'My Checklist',
      });
    });

    it('createChecklist should throw when no cardId', async () => {
      const client = createClient();
      await expect(client.createChecklist('Name', '')).rejects.toThrow('cardId is required');
    });

    it('updateChecklistItem should update state', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'ci1', state: 'complete' } });

      const client = createClient();
      await client.updateChecklistItem('c1', 'ci1', 'complete');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/c1/checkItem/ci1', {
        state: 'complete',
      });
    });
  });

  describe('getAcceptanceCriteria', () => {
    // Builds a Trello checklist payload; `items` is a list of [name, complete] tuples.
    function checklist(id: string, name: string, items: Array<[string, boolean]> = []) {
      return {
        id,
        name,
        idCard: 'c1',
        pos: 1,
        checkItems: items.map(([itemName, complete], index) => ({
          id: `${id}-i${index + 1}`,
          name: itemName,
          state: complete ? 'complete' : 'incomplete',
          pos: index + 1,
        })),
      };
    }

    // Card-scoped path: GET /cards/{id}?checklists=all
    function mockCardChecklists(checklists: ReturnType<typeof checklist>[]) {
      mockAxiosInstance.get.mockResolvedValue({ data: { id: 'c1', checklists } });
    }

    // Board-scoped path: GET /boards/{id}/checklists
    function mockBoardChecklists(checklists: ReturnType<typeof checklist>[]) {
      mockAxiosInstance.get.mockResolvedValue({ data: checklists });
    }

    // AC1
    it('should match a checklist named "AC" and report its board spelling', async () => {
      mockCardChecklists([checklist('cl1', 'AC', [['ships behind a flag', false]])]);

      const client = createClient();
      const result = await client.getAcceptanceCriteria('c1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/cards/c1', {
        params: { checklists: 'all' },
      });
      expect(result).toEqual({
        found: true,
        matchedChecklistName: 'AC',
        percentComplete: 0,
        items: [
          { id: 'cl1-i1', text: 'ships behind a flag', complete: false, parentCheckListId: 'cl1' },
        ],
        unmet: [
          { id: 'cl1-i1', text: 'ships behind a flag', complete: false, parentCheckListId: 'cl1' },
        ],
      });
    });

    // AC2
    it('should match "DoD"', async () => {
      mockCardChecklists([checklist('cl1', 'DoD', [['tests pass', true]])]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result).toMatchObject({
        found: true,
        matchedChecklistName: 'DoD',
        items: [{ text: 'tests pass' }],
      });
    });

    // AC2
    it('should match "Definition of Done"', async () => {
      mockCardChecklists([checklist('cl1', 'Definition of Done', [['docs updated', false]])]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result).toMatchObject({
        found: true,
        matchedChecklistName: 'Definition of Done',
        items: [{ text: 'docs updated' }],
      });
    });

    // AC2: case-insensitive, whitespace-trimmed; matchedChecklistName keeps original casing
    it('should match mixed-case and padded alias spellings without canonicalizing the name', async () => {
      mockCardChecklists([checklist('cl1', '  dod  ', [['reviewed', false]])]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result).toMatchObject({ found: true, matchedChecklistName: '  dod  ' });

      mockCardChecklists([checklist('cl2', 'acceptance CRITERIA', [['reviewed', false]])]);
      const mixed = await createClient().getAcceptanceCriteria('c1');
      expect(mixed).toMatchObject({ found: true, matchedChecklistName: 'acceptance CRITERIA' });
    });

    // AC3
    it('should compute percentComplete and unmet for 4 items with 2 complete', async () => {
      mockCardChecklists([
        checklist('cl1', 'Acceptance Criteria', [
          ['one', true],
          ['two', false],
          ['three', true],
          ['four', false],
        ]),
      ]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result).toMatchObject({ found: true, percentComplete: 50 });
      if (!result.found) throw new Error('expected found');
      expect(result.items).toHaveLength(4);
      expect(result.unmet.map(item => item.text)).toEqual(['two', 'four']);
      expect(result.unmet.every(item => item.complete === false)).toBe(true);
    });

    // Pins the rounding mode: 2/3 = 66.67 rounds to 67, but floors to 66.
    it('should round percentComplete up when the fraction exceeds .5 (kills a floor implementation)', async () => {
      mockCardChecklists([
        checklist('cl1', 'Acceptance Criteria', [
          ['one', true],
          ['two', true],
          ['three', false],
        ]),
      ]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result).toMatchObject({ found: true, percentComplete: 67 });
    });

    // Pins the rounding mode: 1/3 = 33.33 rounds to 33, but ceils to 34.
    it('should round percentComplete down when the fraction is below .5 (kills a ceil implementation)', async () => {
      mockCardChecklists([
        checklist('cl1', 'Acceptance Criteria', [
          ['one', true],
          ['two', false],
          ['three', false],
        ]),
      ]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result).toMatchObject({ found: true, percentComplete: 33 });
    });

    // AC4
    it('should return an explicit not-found with the checklists that do exist', async () => {
      mockCardChecklists([
        checklist('cl1', 'Backlog', [['someday', false]]),
        checklist('cl2', 'QA', [['smoke test', false]]),
      ]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result.found).toBe(false);
      if (result.found) throw new Error('expected not found');
      expect(result.availableChecklists).toEqual(['Backlog', 'QA']);
      expect(result.reason).toContain('Acceptance Criteria');
      expect(result.reason).toContain('AC');
      expect(result.reason).toContain('DoD');
      expect(result.reason).toContain('Definition of Done');
      expect(result.reason).toMatch(/card/);
      expect(result).not.toHaveProperty('items');
    });

    it('should return an empty availableChecklists array when the card has no checklists at all', async () => {
      mockCardChecklists([]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result).toMatchObject({ found: false, availableChecklists: [] });
    });

    // AC5: matched-but-empty is distinguishable from not-found
    it('should distinguish a matched-but-empty checklist from not-found', async () => {
      mockCardChecklists([checklist('cl1', 'AC', [])]);
      const empty = await createClient().getAcceptanceCriteria('c1');

      expect(empty).toEqual({
        found: true,
        items: [],
        unmet: [],
        percentComplete: 0,
        matchedChecklistName: 'AC',
      });

      mockCardChecklists([checklist('cl9', 'Backlog', [])]);
      const missing = await createClient().getAcceptanceCriteria('c1');

      expect(missing.found).toBe(false);
      expect(empty.found).toBe(true);
      expect(empty).not.toEqual(missing);
    });

    it('should prefer the highest-precedence alias when several are present', async () => {
      mockCardChecklists([
        checklist('cl1', 'DoD', [['dod item', false]]),
        checklist('cl2', 'AC', [['ac item', false]]),
        checklist('cl3', 'Acceptance Criteria', [['canonical item', false]]),
      ]);

      const result = await createClient().getAcceptanceCriteria('c1');

      expect(result).toMatchObject({ found: true, matchedChecklistName: 'Acceptance Criteria' });
      if (!result.found) throw new Error('expected found');
      expect(result.items.map(item => item.text)).toEqual(['canonical item']);
    });

    it('should aggregate every checklist matching the winning alias in API order', async () => {
      mockCardChecklists([
        checklist('cl1', 'ac', [['first', true]]),
        checklist('cl2', 'AC', [['second', false]]),
        checklist('cl3', 'DoD', [['ignored', false]]),
      ]);

      const result = await createClient().getAcceptanceCriteria('c1');

      if (!result.found) throw new Error('expected found');
      expect(result.matchedChecklistName).toBe('ac');
      expect(result.items.map(item => item.text)).toEqual(['first', 'second']);
      expect(result.items.map(item => item.parentCheckListId)).toEqual(['cl1', 'cl2']);
      expect(result.percentComplete).toBe(50);
    });

    it('should resolve aliases on the board-scoped path with an explicit boardId', async () => {
      mockBoardChecklists([
        checklist('cl1', 'Backlog', [['nope', false]]),
        checklist('cl2', 'Definition of Done', [
          ['board item', true],
          ['board item 2', false],
        ]),
      ]);

      const client = createClient();
      const result = await client.getAcceptanceCriteria(undefined, 'board123');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/boards/board123/checklists');
      expect(result).toMatchObject({
        found: true,
        matchedChecklistName: 'Definition of Done',
        percentComplete: 50,
      });
      if (!result.found) throw new Error('expected found');
      expect(result.unmet.map(item => item.text)).toEqual(['board item 2']);
    });

    it('should fall back to the active board and report board scope in the not-found reason', async () => {
      mockBoardChecklists([checklist('cl1', 'Backlog', [])]);

      const client = createClient({ boardId: 'active-board' });
      const result = await client.getAcceptanceCriteria();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/boards/active-board/checklists');
      expect(result).toMatchObject({ found: false, availableChecklists: ['Backlog'] });
      if (result.found) throw new Error('expected not found');
      expect(result.reason).toContain('board');
    });

    it('should throw when neither a card, a board, nor an active board is available', async () => {
      const client = createClient();

      await expect(client.getAcceptanceCriteria()).rejects.toThrow(
        'No board ID or card ID provided and no active board set'
      );
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });
  });

  describe('Members', () => {
    it('getBoardMembers should fetch members', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      const client = createClient({ boardId: 'b1' });
      await client.getBoardMembers();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/boards/b1/members');
    });

    it('assignMemberToCard should post member and return the members on the card', async () => {
      const members = [{ id: 'm1', username: 'ada', fullName: 'Ada' }];
      mockAxiosInstance.post.mockResolvedValue({ data: members });

      const client = createClient();
      const result = await client.assignMemberToCard('c1', 'm1');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/cards/c1/idMembers', { value: 'm1' });
      expect(result).toEqual(members);
    });

    it('removeMemberFromCard should delete member', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: [] });

      const client = createClient();
      await client.removeMemberFromCard('c1', 'm1');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/cards/c1/idMembers/m1');
    });
  });

  describe('Labels', () => {
    it('createLabel should post to board', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'lbl1' } });

      const client = createClient({ boardId: 'b1' });
      await client.createLabel(undefined, 'Bug', 'red');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/boards/b1/labels', {
        name: 'Bug',
        color: 'red',
      });
    });

    it('updateLabel should put with provided fields', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'lbl1' } });

      const client = createClient();
      await client.updateLabel('lbl1', 'New Name', 'blue');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/labels/lbl1', {
        name: 'New Name',
        color: 'blue',
      });
    });

    it('updateLabel should only include defined fields', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'lbl1' } });

      const client = createClient();
      await client.updateLabel('lbl1', 'Name');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/labels/lbl1', { name: 'Name' });
    });

    it('deleteLabel should call delete', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const client = createClient();
      await client.deleteLabel('lbl1');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/labels/lbl1');
    });
  });

  describe('custom fields', () => {
    it('should set list custom fields using idValue', async () => {
      const item = { id: 'item1', idCustomField: 'field1', idValue: 'option1' };
      mockAxiosInstance.put.mockResolvedValue({ data: item });

      const client = createClient();
      const result = await client.updateCardCustomField('card1', 'field1', {
        type: 'list',
        value: 'option1',
      });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/card1/customField/field1/item', {
        idValue: 'option1',
      });
      expect(result).toEqual(item);
    });

    it('should clear custom fields with value and idValue empty strings', async () => {
      const item = { id: 'item1', idCustomField: 'field1', value: null };
      mockAxiosInstance.put.mockResolvedValue({ data: item });

      const client = createClient();
      const result = await client.updateCardCustomField('card1', 'field1', {
        type: 'clear',
      });

      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/card1/customField/field1/item', {
        value: '',
        idValue: '',
      });
      expect(result).toEqual(item);
    });
  });

  describe('copyCard', () => {
    it('should post with idCardSource and keepFromSource=all by default', async () => {
      const copiedCard = { id: 'c2', name: 'Copied Card' };
      mockAxiosInstance.post.mockResolvedValue({ data: copiedCard });

      const client = createClient();
      const result = await client.copyCard({
        sourceCardId: 'c1',
        listId: 'l1',
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/cards', {
        idCardSource: 'c1',
        idList: 'l1',
        name: undefined,
        desc: undefined,
        keepFromSource: 'all',
        pos: undefined,
      });
      expect(result).toEqual(copiedCard);
    });

    it('should allow overriding name and keepFromSource', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'c2' } });

      const client = createClient();
      await client.copyCard({
        sourceCardId: 'c1',
        listId: 'l1',
        name: 'Custom Name',
        keepFromSource: 'checklists,labels',
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/cards', {
        idCardSource: 'c1',
        idList: 'l1',
        name: 'Custom Name',
        desc: undefined,
        keepFromSource: 'checklists,labels',
        pos: undefined,
      });
    });
  });

  describe('copyChecklist', () => {
    it('should post with idChecklistSource', async () => {
      const checklist = { id: 'cl2', name: 'Copied', checkItems: [] };
      mockAxiosInstance.post.mockResolvedValue({ data: checklist });

      const client = createClient();
      const result = await client.copyChecklist({
        sourceChecklistId: 'cl1',
        cardId: 'c2',
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/checklists', {
        idCard: 'c2',
        idChecklistSource: 'cl1',
        name: undefined,
        pos: undefined,
      });
      expect(result).toEqual(checklist);
    });

    it('should allow overriding name', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'cl2' } });

      const client = createClient();
      await client.copyChecklist({
        sourceChecklistId: 'cl1',
        cardId: 'c2',
        name: 'Renamed Checklist',
        pos: 'top',
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/checklists', {
        idCard: 'c2',
        idChecklistSource: 'cl1',
        name: 'Renamed Checklist',
        pos: 'top',
      });
    });
  });

  describe('batchAddCards', () => {
    // An axios error as the client sees it: a status, or no reply at all.
    const httpError = (status: number, data: unknown = 'refused') =>
      Object.assign(new Error(`status ${status}`), {
        isAxiosError: true,
        response: { status, data },
      });
    const noReply = () =>
      Object.assign(new Error('timeout of 30000ms exceeded'), {
        isAxiosError: true,
        code: 'ECONNABORTED',
      });

    // The three reads the check makes, plus the duplicate search and the full card read.
    function mockReads(options: { listCards?: Array<{ id: string; name: string }>[] } = {}) {
      const listCards = options.listCards ?? [[]];
      let listRead = 0;
      mockAxiosInstance.get.mockImplementation(async (url: string) => {
        if (url === '/lists/l1') return { data: { id: 'l1', idBoard: 'b1' } };
        if (url === '/boards/b1/labels') return { data: [{ id: 'lbl1' }] };
        if (url === '/lists/l1/cards') {
          const data = listCards[Math.min(listRead, listCards.length - 1)];
          listRead++;
          return { data };
        }
        if (url.startsWith('/cards/')) return { data: { id: url.slice(7), name: 'full card' } };
        throw httpError(404);
      });
    }

    async function run(promise: Promise<unknown>) {
      await vi.runAllTimersAsync();
      return promise;
    }

    beforeEach(() => {
      mockAxiosInstance.get.mockReset();
      mockAxiosInstance.post.mockReset();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should create multiple cards in order', async () => {
      mockReads();
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: 'c1', name: 'Card 1' } })
        .mockResolvedValueOnce({ data: { id: 'c2', name: 'Card 2' } })
        .mockResolvedValueOnce({ data: { id: 'c3', name: 'Card 3' } });

      const client = createClient();
      const result = await client.batchAddCards('l1', [
        { name: 'Card 1' },
        { name: 'Card 2', description: 'Desc' },
        { name: 'Card 3', labels: ['lbl1'] },
      ]);

      expect(result.created.map(card => card.id)).toEqual(['c1', 'c2', 'c3']);
      expect(result.stopped).toBeUndefined();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it('should handle empty array without any request', async () => {
      const client = createClient();
      const result = await client.batchAddCards('l1', []);
      expect(result).toEqual({ created: [] });
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should reject when exceeding card limit', async () => {
      const client = createClient();
      const tooMany = Array.from({ length: 51 }, (_, i) => ({ name: `Card ${i}` }));
      await expect(client.batchAddCards('l1', tooMany)).rejects.toThrow(
        'Cannot create more than 50'
      );
    });

    describe('check before any write', () => {
      it('should create nothing when the list does not exist', async () => {
        mockAxiosInstance.get.mockRejectedValue(httpError(404));

        const client = createClient();
        await expect(client.batchAddCards('l1', [{ name: 'A' }])).rejects.toThrow(
          'List l1 does not exist. No cards were created.'
        );
        expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      });

      it('should name every bad date and overlong description offline, with no request', async () => {
        const client = createClient();
        const error = await client
          .batchAddCards('l1', [
            { name: 'A', dueDate: '2026-09-30' },
            { name: 'B', dueDate: 'tomorrow' },
            { name: 'C', start: '1' },
            { name: 'D', description: 'x'.repeat(2401) },
            { name: 'E', description: 'x'.repeat(2400) },
          ])
          .catch(e => e);

        expect(error.message).toContain('No cards were created');
        expect(error.message).toContain('card 2 "B": dueDate "tomorrow" is not an ISO 8601 date');
        expect(error.message).toContain('card 3 "C": start "1" is not an ISO 8601 date');
        expect(error.message).toContain(
          'card 4 "D": description is 2401 characters, 1 over the 2400 limit'
        );
        expect(error.message).not.toContain('card 1');
        expect(error.message).not.toContain('card 5');
        expect(mockAxiosInstance.get).not.toHaveBeenCalled();
        expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      });

      it('should name every label that is not on the board, and create nothing', async () => {
        mockReads();

        const client = createClient();
        const error = await client
          .batchAddCards('l1', [
            { name: 'A', labels: ['lbl1'] },
            { name: 'B', labels: ['other'] },
          ])
          .catch(e => e);

        expect(error.message).toContain('card 2 "B": label other is not on this board');
        expect(error.message).not.toContain('card 1');
        expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      });

      it('should skip the label read when no card has labels', async () => {
        mockReads();
        mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 'c1', name: 'A' } });

        const client = createClient();
        await client.batchAddCards('l1', [{ name: 'A', dueDate: '2026-09-30T12:00:00Z' }]);

        expect(mockAxiosInstance.get).not.toHaveBeenCalledWith(
          '/boards/b1/labels',
          expect.anything()
        );
      });
    });

    describe('retry on a temporary fault', () => {
      it('should retry a 503 on a card, then carry on', async () => {
        mockReads();
        mockAxiosInstance.post
          .mockResolvedValueOnce({ data: { id: 'c1', name: 'A' } })
          .mockRejectedValueOnce(httpError(503))
          .mockResolvedValueOnce({ data: { id: 'c2', name: 'B' } });

        const client = createClient();
        const result = await run(client.batchAddCards('l1', [{ name: 'A' }, { name: 'B' }]));

        expect(result).toMatchObject({ created: [{ id: 'c1' }, { id: 'c2' }] });
        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      });

      it('should stop on a 429 the interceptor could not clear, and know the card was not made', async () => {
        mockReads();
        mockAxiosInstance.post.mockRejectedValueOnce(httpError(429));

        const client = createClient();
        const result = (await run(client.batchAddCards('l1', [{ name: 'A' }]))) as {
          stopped: { uncertain: boolean };
        };

        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
        expect(result.stopped.uncertain).toBe(false);
        const listReads = mockAxiosInstance.get.mock.calls.filter(
          ([url]) => url === '/lists/l1/cards'
        );
        expect(listReads).toHaveLength(1);
      });

      it('should adopt the card instead of posting again when a lost reply had created it', async () => {
        mockReads({
          listCards: [
            [{ id: 'old', name: 'A' }],
            [
              { id: 'old', name: 'A' },
              { id: 'new', name: 'A' },
            ],
          ],
        });
        mockAxiosInstance.post.mockRejectedValueOnce(noReply());

        const client = createClient();
        const result = await run(client.batchAddCards('l1', [{ name: 'A' }]));

        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ created: [{ id: 'new' }] });
        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/cards/new');
      });

      it('should post again when the lost reply had not created the card', async () => {
        mockReads({ listCards: [[{ id: 'old', name: 'A' }]] });
        mockAxiosInstance.post
          .mockRejectedValueOnce(noReply())
          .mockResolvedValueOnce({ data: { id: 'c1', name: 'A' } });

        const client = createClient();
        const result = await run(client.batchAddCards('l1', [{ name: 'A' }]));

        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ created: [{ id: 'c1' }] });
      });
    });

    describe('stop and report', () => {
      it('should stop at a 403 without retrying, and report what was and was not created', async () => {
        mockReads();
        mockAxiosInstance.post
          .mockResolvedValueOnce({ data: { id: 'c1', name: 'A' } })
          .mockResolvedValueOnce({ data: { id: 'c2', name: 'B' } })
          .mockRejectedValueOnce(httpError(403, 'unauthorized card permission requested'));

        const client = createClient();
        const result = await run(
          client.batchAddCards('l1', [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])
        );

        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
        expect(result).toMatchObject({
          created: [{ id: 'c1' }, { id: 'c2' }],
          stopped: { card: 3, name: 'C', uncertain: false },
        });
        expect((result as { stopped: { message: string } }).stopped.message).toBe(
          'Stopped at card 3 of 4 ("C"): Trello returned 403: unauthorized card permission requested. ' +
            'Cards 1 and 2 were created. Cards 3 and 4 were not created. ' +
            'Ask the user how to resolve this before retrying.'
        );
      });

      it('should stop after the retries run out on a 503', async () => {
        mockReads();
        mockAxiosInstance.post.mockRejectedValue(httpError(503));

        const client = createClient();
        const result = (await run(client.batchAddCards('l1', [{ name: 'A' }]))) as {
          created: unknown[];
          stopped: { message: string; uncertain: boolean };
        };

        expect(mockAxiosInstance.post).toHaveBeenCalledTimes(4);
        expect(result.created).toEqual([]);
        expect(result.stopped.uncertain).toBe(true);
      });

      it('should say the card may exist when the reply was lost and never confirmed', async () => {
        mockReads();
        mockAxiosInstance.post
          .mockResolvedValueOnce({ data: { id: 'c1', name: 'A' } })
          .mockRejectedValue(noReply());

        const client = createClient();
        const result = (await run(
          client.batchAddCards('l1', [{ name: 'A' }, { name: 'B' }, { name: 'C' }])
        )) as { stopped: { message: string; uncertain: boolean } };

        expect(result.stopped.uncertain).toBe(true);
        expect(result.stopped.message).toBe(
          'Stopped at card 2 of 3 ("B"): no reply from Trello (ECONNABORTED). ' +
            'Card 1 was created. ' +
            'Card 2 may have been created: Trello did not reply and it could not be confirmed. Check the list. ' +
            'Card 3 was not created. ' +
            'Ask the user how to resolve this before retrying.'
        );
      });

      it('should say no cards were created when the first card stops', async () => {
        mockReads();
        mockAxiosInstance.post.mockRejectedValueOnce(httpError(400, 'invalid value for idList'));

        const client = createClient();
        const result = (await run(client.batchAddCards('l1', [{ name: 'A' }]))) as {
          stopped: { message: string };
        };

        expect(result.stopped.message).toBe(
          'Stopped at card 1 of 1 ("A"): Trello returned 400: invalid value for idList. ' +
            'No cards were created. ' +
            'Ask the user how to resolve this before retrying.'
        );
      });
    });
  });

  describe('getCard', () => {
    it('should fetch card with all fields', async () => {
      const card = { id: 'c1', name: 'Card', checklists: [], labels: [] };
      mockAxiosInstance.get.mockResolvedValue({ data: card });

      const client = createClient();
      await client.getCard('c1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/cards/c1', {
        params: expect.objectContaining({
          attachments: true,
          checklists: 'all',
          members: true,
          labels: true,
        }),
      });
    });
  });

  describe('getCardHistory', () => {
    it('should fetch card actions with optional params', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      const client = createClient();
      await client.getCardHistory('c1', 'commentCard', 10);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/cards/c1/actions', {
        params: { filter: 'commentCard', limit: 10 },
      });
    });

    it('should fetch without optional params', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      const client = createClient();
      await client.getCardHistory('c1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/cards/c1/actions', {
        params: {},
      });
    });
  });

  describe('attachToCard', () => {
    it('should post to the card and return the attachment', async () => {
      const attachment = { id: 'a1', name: 'shot.png' };
      mockAxiosInstance.post.mockResolvedValue({ data: attachment });
      const client = createClient();

      const result = await client.attachToCard(
        'c1',
        `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
        'shot'
      );

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/cards/c1/attachments',
        expect.anything(),
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(result).toEqual(attachment);
    });

    it('should reject a source without a known prefix without uploading', async () => {
      const client = createClient();
      await expect(client.attachToCard('c1', 'aGVsbG8=')).rejects.toThrow(
        /must start with https:\/\/, file:\/\/ or data:/
      );
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('retry interceptor', () => {
    const httpError = (status: number, method: string) =>
      Object.assign(new Error(`status ${status}`), {
        isAxiosError: true,
        response: { status },
        config: { method, url: '/x' },
      });
    const noReply = (method: string) =>
      Object.assign(new Error('timeout'), {
        isAxiosError: true,
        code: 'ECONNABORTED',
        config: { method, url: '/x' },
      });

    function onError() {
      createClient();
      const calls = mockAxiosInstance.interceptors.response.use.mock.calls;
      return calls[calls.length - 1][1] as (error: unknown) => Promise<unknown>;
    }

    beforeEach(() => {
      mockAxiosInstance.request.mockReset();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function settle(promise: Promise<unknown>) {
      const outcome = promise.then(
        value => ({ value }),
        error => ({ error })
      );
      await vi.runAllTimersAsync();
      return outcome;
    }

    it('should repeat a 429 for a write, because Trello refused it before acting', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({ data: 'ok' });
      const outcome = await settle(onError()(httpError(429, 'post')));
      expect(outcome).toEqual({ value: { data: 'ok' } });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it('should repeat a 503 and a lost reply for a read', async () => {
      mockAxiosInstance.request.mockResolvedValue({ data: 'ok' });
      const handler = onError();
      expect(await settle(handler(httpError(503, 'get')))).toEqual({ value: { data: 'ok' } });
      expect(await settle(handler(noReply('get')))).toEqual({ value: { data: 'ok' } });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should never repeat a 503 or a lost reply for a write, which may have happened', async () => {
      const handler = onError();
      for (const error of [httpError(503, 'post'), noReply('put'), noReply('delete')]) {
        expect(await settle(handler(error))).toEqual({ error });
      }
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it('should not repeat a download this side refused as too large', async () => {
      const error = Object.assign(new Error('maxContentLength size of 5 exceeded'), {
        isAxiosError: true,
        code: 'ERR_BAD_RESPONSE',
        config: { method: 'get', url: '/x' },
      });
      expect(await settle(onError()(error))).toEqual({ error });
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it('should not repeat a 4xx other than 429', async () => {
      const error = httpError(404, 'get');
      expect(await settle(onError()(error))).toEqual({ error });
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it('should give up after 3 repeats', async () => {
      const error = httpError(503, 'get');
      (error.config as { retries?: number }).retries = 3;
      expect(await settle(onError()(error))).toEqual({ error });
      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it('should count each repeat on the request itself', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({ data: 'ok' });
      const error = httpError(503, 'get');
      await settle(onError()(error));
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ retries: 1 })
      );
    });
  });

  describe('description limit', () => {
    it('should refuse an overlong description before any request', async () => {
      const client = createClient();
      await expect(
        client.addCard(undefined, { listId: 'l1', name: 'A', description: 'x'.repeat(2401) })
      ).rejects.toThrow(
        'Description is 2401 characters, 1 over the 2400 limit. Shorten it and send it again. Nothing was sent to Trello.'
      );
      await expect(
        client.updateCard(undefined, { cardId: 'c1', description: 'x'.repeat(3000) })
      ).rejects.toThrow('600 over the 2400 limit');
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(mockAxiosInstance.put).not.toHaveBeenCalled();
    });

    it('should accept exactly 2400 characters', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 'c1' } });
      const client = createClient();
      await client.addCard(undefined, { listId: 'l1', name: 'A', description: 'x'.repeat(2400) });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should count an emoji or an accented letter as one character', async () => {
      mockAxiosInstance.put.mockResolvedValueOnce({ data: { id: 'c1' } });
      const client = createClient();
      await client.updateCard(undefined, { cardId: 'c1', description: '\u{1F600}'.repeat(2400) });
      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveCardId', () => {
    it('should return a card id unchanged, with no request', async () => {
      const client = createClient();
      expect(await client.resolveCardId('c1')).toBe('c1');
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('should look a card number up on the given board', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 'c53' } });
      const client = createClient();
      expect(await client.resolveCardId(undefined, 53, 'b1')).toBe('c53');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/boards/b1/cards/53', {
        params: { fields: 'id' },
      });
    });

    it('should use the active board when none is given', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 'c53' } });
      const client = createClient({ boardId: 'active' });
      await client.resolveCardId(undefined, 53);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/boards/active/cards/53',
        expect.anything()
      );
    });

    it('should say so when the board has no card with that number', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(
        Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } })
      );
      const client = createClient();
      await expect(client.resolveCardId(undefined, 999, 'b1')).rejects.toThrow(
        'No card number 999 on board b1'
      );
    });

    it('should refuse both or neither of cardId and cardNumber', async () => {
      const client = createClient({ boardId: 'b1' });
      await expect(client.resolveCardId('c1', 53)).rejects.toThrow(
        'Give cardId or cardNumber, not both'
      );
      await expect(client.resolveCardId()).rejects.toThrow(
        /^MCP error -32602: Give cardId or cardNumber$/
      );
    });

    it('should refuse a card number with no board to look on', async () => {
      const client = createClient();
      await expect(client.resolveCardId(undefined, 53)).rejects.toThrow('boardId is required');
    });
  });

  describe('boardId as a check', () => {
    const onBoard = (idBoard: string, shortLink = 'AbCd1234') => ({
      data: { id: 'x', idBoard, board: { id: idBoard, shortLink } },
    });

    it('should make no extra request when no board is given', async () => {
      mockAxiosInstance.put.mockResolvedValueOnce({ data: { id: 'l1' } });
      const client = createClient({ boardId: 'active' });
      await client.archiveList(undefined, 'l1');
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('should allow a list on the given board, by id or by short link', async () => {
      mockAxiosInstance.get.mockResolvedValue(onBoard('b1'));
      mockAxiosInstance.put.mockResolvedValue({ data: { id: 'l1' } });
      const client = createClient();

      await client.archiveList('b1', 'l1');
      await client.archiveList('AbCd1234', 'l1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/lists/l1', {
        params: { fields: 'idBoard', board: true, board_fields: 'shortLink' },
      });
      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(2);
    });

    it('should refuse a list on another board, and do nothing', async () => {
      mockAxiosInstance.get.mockResolvedValue(onBoard('b2'));
      const client = createClient();

      for (const call of [
        () => client.archiveList('b1', 'l1'),
        () => client.addCard('b1', { listId: 'l1', name: 'A' }),
        () => client.getCardsByList('l1', undefined, undefined, 'b1'),
      ]) {
        await expect(call()).rejects.toThrow(
          'The list l1 is on board b2, not on board b1. Nothing was done.'
        );
      }
      expect(mockAxiosInstance.put).not.toHaveBeenCalled();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(mockAxiosInstance.get).not.toHaveBeenCalledWith('/lists/l1/cards', expect.anything());
    });

    it('should say so when the list does not exist', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(
        Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } })
      );
      const client = createClient();
      await expect(client.archiveList('b1', 'nope')).rejects.toThrow('No list nope');
    });

    it('should refuse a card id that is not on the given board', async () => {
      mockAxiosInstance.get.mockResolvedValue(onBoard('b2'));
      const client = createClient();

      await expect(client.archiveCard('b1', 'c1')).rejects.toThrow(
        'The card c1 is on board b2, not on board b1'
      );
      await expect(client.updateCard('b1', { cardId: 'c1', name: 'x' })).rejects.toThrow(
        'not on board b1'
      );
      await expect(client.resolveCardId('c1', undefined, 'b1')).rejects.toThrow('not on board b1');
      expect(mockAxiosInstance.put).not.toHaveBeenCalled();
    });
  });

  describe('card number on update and archive', () => {
    it('should update a card named by its number', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 'c53' } });
      mockAxiosInstance.put.mockResolvedValueOnce({ data: { id: 'c53' } });
      const client = createClient();

      await client.updateCard('b1', { cardNumber: 53, name: 'Chat button' });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/boards/b1/cards/53', expect.anything());
      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/cards/c53',
        expect.objectContaining({ name: 'Chat button' })
      );
    });

    it('should archive a card named by its number on the active board', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 'c53' } });
      mockAxiosInstance.put.mockResolvedValueOnce({ data: { id: 'c53' } });
      const client = createClient({ boardId: 'active' });

      await client.archiveCard(undefined, undefined, 53);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/boards/active/cards/53',
        expect.anything()
      );
      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/cards/c53', { closed: true });
    });

    it('should check the description before looking the number up', async () => {
      const client = createClient();
      await expect(
        client.updateCard('b1', { cardNumber: 53, description: 'x'.repeat(2401) })
      ).rejects.toThrow('over the 2400 limit');
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });
  });

  describe('single labels', () => {
    it('should add one label and return the card label ids', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: ['lbl0', 'lbl1'] });
      const client = createClient();
      const result = await client.addLabelToCard('c1', 'lbl1');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/cards/c1/idLabels', { value: 'lbl1' });
      expect(result).toEqual({ cardId: 'c1', idLabels: ['lbl0', 'lbl1'] });
    });

    it('should remove one label', async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({ data: [] });
      const client = createClient();
      const result = await client.removeLabelFromCard('c1', 'lbl1');
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/cards/c1/idLabels/lbl1');
      expect(result).toEqual({ cardId: 'c1', removed: 'lbl1' });
    });
  });

  describe('workspace guard wiring', () => {
    it('should add the guard only when a restriction is set', () => {
      createClient();
      const without = mockAxiosInstance.interceptors.request.use.mock.calls.length;
      mockAxiosInstance.interceptors.request.use.mockClear();
      createClient({ allowedWorkspaceIds: ['w1'] });
      expect(mockAxiosInstance.interceptors.request.use.mock.calls.length).toBe(without + 1);
    });

    it('should keep only the cards on allowed boards in get_my_cards', async () => {
      mockAxiosInstance.get.mockImplementation(async (url: string) => {
        if (url === '/members/me/cards') {
          return {
            data: [
              { id: 'c1', idBoard: 'b1' },
              { id: 'c2', idBoard: 'b2' },
              { id: 'c3', idBoard: 'b1' },
            ],
          };
        }
        if (url === '/boards/b1') return { data: { id: 'b1', idOrganization: 'w1' } };
        if (url === '/boards/b2') return { data: { id: 'b2', idOrganization: 'other' } };
        throw new Error(url);
      });
      const client = createClient({ allowedWorkspaceIds: ['w1'] });

      const cards = await client.getMyCards();

      expect(cards.map(card => card.id)).toEqual(['c1', 'c3']);
    });
  });

  describe('searchCards', () => {
    const lastParams = () => mockAxiosInstance.get.mock.calls.at(-1)![1].params;

    it('should search cards only, and return the cards', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { cards: [{ id: 'c1' }] } });
      const client = createClient();
      expect(await client.searchCards('chat button')).toEqual([{ id: 'c1' }]);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/search', expect.anything());
      expect(lastParams()).toMatchObject({
        query: 'chat button',
        modelTypes: 'cards',
        cards_limit: 20,
        partial: true,
      });
      expect(lastParams().idBoards).toBeUndefined();
      expect(lastParams().idOrganizations).toBeUndefined();
    });

    it('should limit the search to one board when given', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { cards: [] } });
      const client = createClient();
      await client.searchCards('x', 'b1', 5);
      expect(lastParams()).toMatchObject({ idBoards: 'b1', cards_limit: 5 });
    });

    it('should search only the allowed workspaces when a restriction is set', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { cards: [] } });
      const client = createClient({ allowedWorkspaceIds: ['w1', 'w2'] });
      await client.searchCards('x');
      expect(lastParams().idOrganizations).toBe('w1,w2');
    });

    it('should refuse an empty query', async () => {
      const client = createClient();
      await expect(client.searchCards('  ')).rejects.toThrow('query must not be empty');
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });
  });

  describe('createChecklist with items', () => {
    it('should create the checklist, then each item in order', async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: 'cl1', name: 'Acceptance Criteria', checkItems: [] } })
        .mockResolvedValueOnce({ data: { id: 'i1', name: 'one' } })
        .mockResolvedValueOnce({ data: { id: 'i2', name: 'two' } });
      const client = createClient();

      const result = await client.createChecklist('Acceptance Criteria', 'c1', ['one', 'two']);

      expect(mockAxiosInstance.post.mock.calls.map(call => call[0])).toEqual([
        '/cards/c1/checklists',
        '/checklists/cl1/checkItems',
        '/checklists/cl1/checkItems',
      ]);
      expect(result.checkItems.map(item => item.name)).toEqual(['one', 'two']);
    });

    it('should say how many items were added when one fails', async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { id: 'cl1', name: 'AC', checkItems: [] } })
        .mockResolvedValueOnce({ data: { id: 'i1', name: 'one' } })
        .mockRejectedValueOnce(new Error('boom'));
      const client = createClient();

      await expect(client.createChecklist('AC', 'c1', ['one', 'two', 'three'])).rejects.toThrow(
        'Checklist "AC" was created with 1 of 3 items. Item 2 ("two") failed: boom. Add the rest with add_checklist_item.'
      );
    });
  });

  const NAME_FILTER_CARDS = [
    {
      id: '1',
      name: 'FEAT: Add Slippage to Position History',
      desc: '',
      due: null,
      idList: 'list1',
      idLabels: [],
      closed: false,
      url: '',
      dateLastActivity: '',
    },
    {
      id: '2',
      name: 'FEAT: Execute trade slippage config',
      desc: '',
      due: null,
      idList: 'list1',
      idLabels: [],
      closed: false,
      url: '',
      dateLastActivity: '',
    },
    {
      id: '3',
      name: 'BUG: Fix login page crash',
      desc: '',
      due: null,
      idList: 'list1',
      idLabels: [],
      closed: false,
      url: '',
      dateLastActivity: '',
    },
    {
      id: '4',
      name: 'Add Slippage to Position History',
      desc: '',
      due: null,
      idList: 'list1',
      idLabels: [],
      closed: false,
      url: '',
      dateLastActivity: '',
    },
  ];

  describe('getCardsByList nameFilter', () => {
    let client: TrelloClient;

    beforeEach(() => {
      mockAxiosInstance.get.mockResolvedValue({ data: NAME_FILTER_CARDS });
      client = createClient();
    });

    it('returns all cards when no nameFilter is provided', async () => {
      const cards = await client.getCardsByList('list1');
      expect(cards).toHaveLength(4);
    });

    it('returns all cards when nameFilter is undefined', async () => {
      const cards = await client.getCardsByList('list1', undefined, undefined);
      expect(cards).toHaveLength(4);
    });

    it('filters by exact name match', async () => {
      const cards = await client.getCardsByList(
        'list1',
        undefined,
        'Add Slippage to Position History'
      );
      expect(cards).toHaveLength(2);
      expect(cards.map(c => c.id)).toEqual(['1', '4']);
    });

    it('filters by substring match', async () => {
      const cards = await client.getCardsByList('list1', undefined, 'FEAT');
      expect(cards).toHaveLength(2);
      expect(cards.map(c => c.id)).toEqual(['1', '2']);
    });

    it('filters case-insensitively', async () => {
      const cards = await client.getCardsByList('list1', undefined, 'add slippage');
      expect(cards).toHaveLength(2);
      expect(cards.map(c => c.id)).toEqual(['1', '4']);
    });

    it('returns empty array when no cards match', async () => {
      const cards = await client.getCardsByList('list1', undefined, 'nonexistent card name');
      expect(cards).toHaveLength(0);
    });

    it('does not match non-contiguous substrings', async () => {
      // "Add History" is not a contiguous substring of any card name
      const cards = await client.getCardsByList('list1', undefined, 'Add History');
      expect(cards).toHaveLength(0);
    });

    it('passes requested fields while filtering by name', async () => {
      const cards = await client.getCardsByList('list1', 'name,idList', 'FEAT');
      expect(cards).toHaveLength(2);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/lists/list1/cards', {
        params: { fields: 'name,idList' },
      });
    });
  });

  describe('error reasons', () => {
    const httpError = (status: number, data: unknown) =>
      Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data },
      });

    it("should keep Trello's reason when it comes as plain text", async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(httpError(400, 'invalid id'));
      const client = createClient();
      await expect(client.getBoardById('x')).rejects.toThrow(
        'Trello API Error: Trello returned 400: invalid id'
      );
    });

    it("should keep Trello's reason when it comes as a JSON message", async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(
        httpError(401, { message: 'invalid token', error: 'ERROR' })
      );
      const client = createClient();
      await expect(client.getBoardById('x')).rejects.toThrow(
        'Trello API Error: Trello returned 401: invalid token'
      );
    });

    it('should keep the reason of an unexpected error', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new TypeError('boom'));
      const client = createClient();
      await expect(client.getBoardById('x')).rejects.toThrow('An unexpected error occurred: boom');
    });

    it("should give a checklist call Trello's reason, as every other call does", async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(httpError(404, 'card not found'));
      const client = createClient();
      await expect(client.getChecklistItems('AC', 'c1')).rejects.toThrow(
        'Trello API Error: Trello returned 404: card not found'
      );
    });
  });

  describe('downloadAttachment', () => {
    it('should refuse a link attachment, which has no file on Trello', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { id: 'a1', isUpload: false, url: 'https://example.com/doc' },
      });
      const client = createClient();
      await expect(client.downloadAttachment('c1', 'a1')).rejects.toThrow(
        'Attachment a1 is a link to https://example.com/doc, not a file stored on Trello'
      );
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it('should download an uploaded file as base64 with the OAuth header', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({
          data: { id: 'a1', isUpload: true, fileName: 'a b.png', mimeType: 'image/png' },
        })
        .mockResolvedValueOnce({ data: Buffer.from('png') });
      const client = createClient();

      const result = await client.downloadAttachment('c1', 'a1');

      const [url, options] = mockAxiosInstance.get.mock.calls[1];
      expect(url).toBe('https://api.trello.com/1/cards/c1/attachments/a1/download/a%20b.png');
      expect(options.headers.Authorization).toContain('oauth_token="test-token"');
      expect(result).toEqual({
        data: Buffer.from('png').toString('base64'),
        mimeType: 'image/png',
        fileName: 'a b.png',
      });
    });
  });

  describe('active board', () => {
    it('should start as TRELLO_BOARD_ID, and a named board wins over it', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [] });
      const client = createClient({ defaultBoardId: 'default' });

      await client.getLists();
      await client.getLists('named');

      expect(mockAxiosInstance.get.mock.calls.map(call => call[0])).toEqual([
        '/boards/default/lists',
        '/boards/named/lists',
      ]);
    });

    it('should refuse a board call with no board anywhere', async () => {
      const client = createClient();
      await expect(client.getLists()).rejects.toThrow(
        'boardId is required when no default board is configured'
      );
    });
  });

  describe('configurable limits', () => {
    it('should default to 2400 characters and 5 MB', () => {
      const client = createClient();
      expect(client.descriptionLimit).toBe(2400);
      expect(client.maxDownloadMb).toBe(5);
    });

    it('should hold a card description to the configured limit', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'c1' } });
      const client = createClient({ descriptionLimit: 100 });

      await client.addCard(undefined, { listId: 'l1', name: 'A', description: 'x'.repeat(100) });
      await expect(
        client.addCard(undefined, { listId: 'l1', name: 'A', description: 'x'.repeat(101) })
      ).rejects.toThrow('Description is 101 characters, 1 over the 100 limit.');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should hold a batch to the configured limit too, with no request', async () => {
      const client = createClient({ descriptionLimit: 10 });
      await expect(
        client.batchAddCards('l1', [{ name: 'A', description: 'x'.repeat(11) }])
      ).rejects.toThrow('card 1 "A": description is 11 characters, 1 over the 10 limit');
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('should refuse an attachment over the download limit from its size, before downloading', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          id: 'a1',
          isUpload: true,
          fileName: 'demo.mp4',
          bytes: 12 * 1024 * 1024,
          url: 'https://trello.com/a/demo.mp4',
        },
      });
      const client = createClient();

      await expect(client.downloadAttachment('c1', 'a1')).rejects.toThrow(
        'Attachment a1 (demo.mp4) is 12.0 MB, over the 5 MB download limit set by TRELLO_MAX_DOWNLOAD_MB. Nothing was downloaded.'
      );
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it('should stop the download itself at the limit when the size is unknown', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: 'a1', isUpload: true, fileName: 'x.bin', url: 'u' } })
        .mockRejectedValueOnce(
          Object.assign(new Error('maxContentLength size of 2097152 exceeded'), {
            isAxiosError: true,
            code: 'ERR_BAD_RESPONSE',
          })
        );
      const client = createClient({ maxDownloadMb: 2 });

      await expect(client.downloadAttachment('c1', 'a1')).rejects.toThrow(
        'is larger than the limit, over the 2 MB download limit'
      );
      expect(mockAxiosInstance.get.mock.calls[1][1]).toMatchObject({
        maxContentLength: 2 * 1024 * 1024,
      });
    });
  });

  describe('Config persistence', () => {
    it('activeBoardId should return configured board', () => {
      const client = createClient({ boardId: 'b1' });
      expect(client.activeBoardId).toBe('b1');
    });

    it('activeBoardId should return undefined when not set', () => {
      const client = createClient();
      expect(client.activeBoardId).toBeUndefined();
    });
  });
});

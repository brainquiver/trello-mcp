import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { WorkspaceGuard } from '../../../src/trello/workspace-guard.js';

// A small Trello: two allowed workspaces' boards, one elsewhere, and one personal board.
const BOARDS: Record<string, { id: string; idOrganization: string | null }> = {
  b1: { id: 'b1', idOrganization: 'w1' },
  AbCd1234: { id: 'b1', idOrganization: 'w1' },
  b2: { id: 'b2', idOrganization: 'other' },
  bp: { id: 'bp', idOrganization: null },
};
const PARENTS: Record<string, { idBoard?: string; idModel?: string; data?: unknown }> = {
  '/lists/l1': { idBoard: 'b1' },
  '/lists/l2': { idBoard: 'b2' },
  '/cards/c1': { idBoard: 'b1' },
  '/cards/c2': { idBoard: 'b2' },
  '/cards/cp': { idBoard: 'bp' },
  '/checklists/k2': { idBoard: 'b2' },
  '/labels/x2': { idBoard: 'b2' },
  '/actions/a2': { data: { board: { id: 'b2' } } },
  '/customFields/f2': { idModel: 'b2' },
};

function fakeTrello() {
  const get = vi.fn(async (route: string) => {
    const board = route.match(/^\/boards\/([^/]+)$/)?.[1];
    const data = board ? BOARDS[board] : PARENTS[route];
    if (!data) throw Object.assign(new Error('404'), { response: { status: 404 } });
    return { data };
  });
  return { get } as unknown as AxiosInstance & { get: typeof get };
}

const request = (method: string, url: string, extra: Partial<InternalAxiosRequestConfig> = {}) =>
  ({ method, url, ...extra }) as InternalAxiosRequestConfig;

describe('WorkspaceGuard', () => {
  let trello: ReturnType<typeof fakeTrello>;
  let guard: WorkspaceGuard;

  beforeEach(() => {
    trello = fakeTrello();
    guard = new WorkspaceGuard(trello, ['w1', 'w2']);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should let through a request inside an allowed workspace, for every kind of route', async () => {
    for (const config of [
      request('get', '/boards/b1/lists'),
      request('get', '/boards/AbCd1234'),
      request('put', '/lists/l1/closed'),
      request('put', '/cards/c1'),
      request('get', '/organizations/w1/boards'),
      request('post', '/cards', { data: { idList: 'l1', name: 'A' } }),
      request('get', '/members/me/cards'),
      request('get', '/search', { params: { query: 'x', idOrganizations: 'w1,w2' } }),
      request('get', 'https://api.trello.com/1/cards/c1/attachments/a/download/f.png'),
    ]) {
      await expect(guard.check(config)).resolves.toBe(config);
    }
  });

  it('should refuse each kind of object that lives in another workspace', async () => {
    for (const [url, what] of [
      ['/boards/b2', 'board b2'],
      ['/lists/l2', 'list l2'],
      ['/cards/c2/actions/comments', 'card c2'],
      ['/checklists/k2/checkItems', 'checklist k2'],
      ['/labels/x2', 'label x2'],
      ['/actions/a2', 'action a2'],
      ['/customFields/f2/options', 'customField f2'],
    ]) {
      await expect(guard.check(request('put', url))).rejects.toThrow(
        `Refused by the workspace guard: ${what} is in workspace other, which is not in TRELLO_ALLOWED_WORKSPACES.`
      );
    }
  });

  it('should refuse a workspace that is not allowed', async () => {
    await expect(guard.check(request('get', '/organizations/other/boards'))).rejects.toThrow(
      'workspace other is not in TRELLO_ALLOWED_WORKSPACES'
    );
  });

  it('should refuse a personal board, which is in no workspace', async () => {
    await expect(guard.check(request('put', '/cards/cp'))).rejects.toThrow(
      'card cp is on a personal board, which is in no allowed workspace'
    );
  });

  it('should check the ids a body or a query carries, not only the path', async () => {
    const outside = [
      request('post', '/cards', { data: { idList: 'l2', name: 'A' } }),
      request('put', '/cards/c1', { data: { idList: 'l2', idBoard: 'b2' } }),
      request('post', '/cards', { data: { idCardSource: 'c2', idList: 'l1' } }),
      request('post', '/checklists', { data: { idCard: 'c1', idChecklistSource: 'k2' } }),
      request('put', '/lists/l1', { data: { idBoard: 'b2' } }),
      request('get', '/search', { params: { query: 'x', idBoards: 'b2' } }),
    ];
    for (const config of outside) {
      await expect(guard.check(config)).rejects.toThrow('Refused by the workspace guard');
    }
  });

  it('should refuse a board created with no workspace, and a search that names none', async () => {
    await expect(guard.check(request('post', '/boards', { data: { name: 'x' } }))).rejects.toThrow(
      'cannot tell which workspace POST /boards touches'
    );
    await expect(
      guard.check(request('get', '/search', { params: { query: 'x' } }))
    ).rejects.toThrow('cannot tell which workspace GET /search touches');
    await expect(
      guard.check(request('post', '/boards', { data: { name: 'x', idOrganization: 'w1' } }))
    ).resolves.toBeDefined();
  });

  it('should refuse a route it does not know', async () => {
    await expect(guard.check(request('get', '/webhooks/1'))).rejects.toThrow(
      'cannot tell which workspace GET /webhooks/1 touches'
    );
    await expect(guard.check(request('get', '/members/someone/boards'))).rejects.toThrow(
      'cannot tell which workspace'
    );
  });

  it('should let an object it cannot find through, since the request will fail on its own', async () => {
    await expect(guard.check(request('get', '/cards/missing'))).resolves.toBeDefined();
  });

  it('should never check its own lookups, or it would loop', async () => {
    await guard.check(request('get', '/cards/c2', { guardLookup: true }));
    expect(trello.get).not.toHaveBeenCalled();
  });

  it('should mark each lookup as its own, so the guard skips it', async () => {
    await guard.check(request('get', '/cards/c1'));
    for (const call of trello.get.mock.calls) {
      expect(call[1]).toMatchObject({ guardLookup: true });
    }
  });

  it('should cache answers, and ask again after ten minutes', async () => {
    vi.useFakeTimers();
    await guard.check(request('get', '/cards/c1'));
    await guard.check(request('put', '/cards/c1'));
    expect(trello.get).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await guard.check(request('get', '/cards/c1'));
    expect(trello.get).toHaveBeenCalledTimes(4);
  });

  it('should stop the request when a lookup fails for another reason', async () => {
    trello.get.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), {}));
    await expect(guard.check(request('get', '/cards/c1'))).rejects.toThrow(
      'The workspace guard could not check /cards/c1: socket hang up. Nothing was sent.'
    );
  });

  it('should tell whether a board is allowed, for filtering', async () => {
    expect(await guard.allowsBoard('b1')).toBe(true);
    expect(await guard.allowsBoard('b2')).toBe(false);
    expect(await guard.allowsBoard('bp')).toBe(false);
  });
});

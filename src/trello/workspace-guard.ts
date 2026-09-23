import { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

declare module 'axios' {
  interface AxiosRequestConfig {
    // Set on the guard's own lookups, so they do not pass through the guard again.
    guardLookup?: boolean;
  }
}

type Kind = 'list' | 'card' | 'checklist' | 'label' | 'action' | 'customField';
type Target = { kind: 'workspace' | 'board' | Kind; id: string };

const BASE_URL = 'https://api.trello.com/1';

// A card can be moved to another board outside this server, so no answer is kept for ever.
const CACHE_MS = 10 * 60 * 1000;

const BY_RESOURCE: Record<string, Target['kind']> = {
  organizations: 'workspace',
  boards: 'board',
  lists: 'list',
  cards: 'card',
  checklists: 'checklist',
  labels: 'label',
  actions: 'action',
  customFields: 'customField',
};

// Ids a request can carry in its query or its body, and what each one names.
const BY_FIELD: Record<string, Target['kind']> = {
  idOrganization: 'workspace',
  idOrganizations: 'workspace',
  idBoard: 'board',
  idBoards: 'board',
  idList: 'list',
  idCard: 'card',
  idCardSource: 'card',
  idChecklistSource: 'checklist',
};

/**
 * Keeps every request inside the workspaces in TRELLO_ALLOWED_WORKSPACES. A request is
 * traced to what it touches, from its path, its query and its body, then each of those to
 * its board, and each board to its workspace. A personal board is in no workspace, so it
 * is refused. A route the guard cannot trace is refused, never let through.
 */
export class WorkspaceGuard {
  private readonly allowed: Set<string>;
  private readonly boards = new Map<string, { value: string | undefined; at: number }>();
  private readonly workspaces = new Map<string, { value: string | null; at: number }>();

  constructor(
    private readonly axiosInstance: AxiosInstance,
    allowedWorkspaceIds: string[]
  ) {
    this.allowed = new Set(allowedWorkspaceIds);
  }

  async check(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    if (config.guardLookup) return config;
    const method = (config.method ?? 'get').toUpperCase();
    const route = (config.url ?? '').replace(BASE_URL, '').split('?')[0];
    const targets = targetsOf(method, route, config.params, config.data);
    if (!targets) {
      throw refused(`it cannot tell which workspace ${method} ${route} touches`);
    }
    for (const target of targets) {
      await this.checkTarget(target);
    }
    return config;
  }

  /** Whether a board is in an allowed workspace. For filtering a list that spans workspaces. */
  async allowsBoard(boardId: string): Promise<boolean> {
    const workspace = await this.workspaceOf(boardId);
    return workspace !== undefined && workspace !== null && this.allowed.has(workspace);
  }

  private async checkTarget(target: Target): Promise<void> {
    if (target.kind === 'workspace') {
      if (!this.allowed.has(target.id)) {
        throw refused(`workspace ${target.id} is not in TRELLO_ALLOWED_WORKSPACES`);
      }
      return;
    }
    const boardId =
      target.kind === 'board' ? target.id : await this.boardOf(target.kind, target.id);
    // The object does not exist, or the token cannot see it: the request itself will fail.
    if (boardId === undefined) return;
    const workspace = await this.workspaceOf(boardId);
    if (workspace === undefined) return;
    const what = target.kind === 'board' ? `board ${boardId}` : `${target.kind} ${target.id}`;
    if (workspace === null) {
      throw refused(`${what} is on a personal board, which is in no allowed workspace`);
    }
    if (!this.allowed.has(workspace)) {
      throw refused(
        `${what} is in workspace ${workspace}, which is not in TRELLO_ALLOWED_WORKSPACES`
      );
    }
  }

  private async boardOf(kind: Kind, id: string): Promise<string | undefined> {
    const key = `${kind}:${id}`;
    const cached = fresh(this.boards.get(key));
    if (cached) return cached.value;
    const data = await this.lookup(
      `/${kind}s/${id}`,
      kind === 'action' ? 'data' : kind === 'customField' ? 'idModel' : 'idBoard'
    );
    const value: string | undefined =
      data === undefined
        ? undefined
        : kind === 'action'
          ? data.data?.board?.id
          : kind === 'customField'
            ? data.idModel
            : data.idBoard;
    this.boards.set(key, { value, at: Date.now() });
    return value;
  }

  private async workspaceOf(boardId: string): Promise<string | null | undefined> {
    const cached = fresh(this.workspaces.get(boardId));
    if (cached) return cached.value;
    const data = await this.lookup(`/boards/${boardId}`, 'idOrganization');
    if (data === undefined) return undefined;
    const entry = { value: (data.idOrganization as string | null) ?? null, at: Date.now() };
    // A board can be named by its id or by the short link in its URL.
    this.workspaces.set(boardId, entry);
    if (data.id) this.workspaces.set(data.id, entry);
    return entry.value;
  }

  private async lookup(route: string, fields: string) {
    try {
      const response = await this.axiosInstance.get(route, {
        params: { fields },
        guardLookup: true,
      });
      return response.data;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 400 || status === 404) return undefined;
      const reason = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `The workspace guard could not check ${route}: ${reason}. Nothing was sent.`
      );
    }
  }
}

/**
 * What a request touches. Undefined means the route is not one the guard knows, which
 * is refused. An empty list means the route touches no workspace, as /members/me does.
 */
function targetsOf(
  method: string,
  route: string,
  params: unknown,
  data: unknown
): Target[] | undefined {
  const [resource, id] = route.split('/').filter(Boolean);
  const targets: Target[] = [];

  if (resource === 'members') {
    // The account's own boards, cards and workspaces. The client filters those replies.
    if (id !== 'me') return undefined;
  } else if (resource === 'search') {
    // Nothing to trace below, so a search must name its boards or workspaces.
  } else if (resource in BY_RESOURCE) {
    if (id) targets.push({ kind: BY_RESOURCE[resource], id });
    // A board created with no workspace would be a personal board.
    else if (resource === 'boards' && method === 'POST' && !fieldOf(data, 'idOrganization')) {
      return undefined;
    }
  } else {
    return undefined;
  }

  for (const source of [params, data]) {
    for (const [field, kind] of Object.entries(BY_FIELD)) {
      const value = fieldOf(source, field);
      if (typeof value !== 'string') continue;
      for (const each of value.split(',')) {
        const trimmed = each.trim();
        if (trimmed && trimmed !== 'mine') targets.push({ kind, id: trimmed });
      }
    }
  }

  if (resource === 'search' && targets.length === 0) return undefined;
  return targets;
}

function fieldOf(source: unknown, field: string): unknown {
  // A plain object only. A multipart upload names its card in the path.
  if (!source || Object.getPrototypeOf(source) !== Object.prototype) return undefined;
  return (source as Record<string, unknown>)[field];
}

function fresh<T extends { at: number }>(entry: T | undefined): T | undefined {
  return entry && Date.now() - entry.at < CACHE_MS ? entry : undefined;
}

function refused(reason: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `Refused by the workspace guard: ${reason}.`);
}

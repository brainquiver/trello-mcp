import axios, { AxiosInstance, CreateAxiosDefaults, InternalAxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  TrelloConfig,
  TrelloCard,
  TrelloList,
  TrelloAction,
  TrelloAttachment,
  TrelloBoard,
  TrelloWorkspace,
  EnhancedTrelloCard,
  TrelloChecklist,
  TrelloCheckItem,
  TrelloCheckItemUpdate,
  CheckList,
  CheckListItem,
  AcceptanceCriteriaResult,
  TrelloComment,
  TrelloMember,
  TrelloLabelDetails,
  TrelloCustomFieldDefinition,
  TrelloCustomFieldOption,
  TrelloCustomFieldItem,
} from './types.js';
import { createTrelloRateLimiters } from './rate-limiter.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as attachments from './attachments.js';
import * as batch from './batch.js';
import * as checklists from './checklists.js';
import { BatchAddCardsResult, BatchCard } from './batch.js';
import { MAX_RETRIES, describeError, isLostReply } from './errors.js';
import { DEFAULT_DESCRIPTION_LIMIT, checkDates, checkDescription } from './validation.js';
import { WorkspaceGuard } from './workspace-guard.js';

// Where the active board and workspace are kept between runs.
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.trello-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const REQUEST_TIMEOUT_MS = 30_000;

// A download comes back as base64 in the agent's context, a third larger than the file.
const DEFAULT_MAX_DOWNLOAD_MB = 5;

export class TrelloClient {
  private axiosInstance: AxiosInstance;
  private rateLimiter;
  private guard?: WorkspaceGuard;
  private activeConfig: TrelloConfig;
  readonly descriptionLimit: number;
  readonly maxDownloadMb: number;

  constructor(private config: TrelloConfig) {
    this.activeConfig = { ...config };
    this.descriptionLimit = config.descriptionLimit ?? DEFAULT_DESCRIPTION_LIMIT;
    this.maxDownloadMb = config.maxDownloadMb ?? DEFAULT_MAX_DOWNLOAD_MB;
    const axiosConfig: CreateAxiosDefaults = {
      baseURL: 'https://api.trello.com/1',
      // A request that hangs would otherwise wait forever and never reach a retry.
      timeout: REQUEST_TIMEOUT_MS,
      params: {
        key: config.apiKey,
        token: config.token,
      },
    };

    const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY;
    if (proxyUrl) {
      const agent = new HttpsProxyAgent(proxyUrl);
      axiosConfig.httpAgent = agent;
      axiosConfig.httpsAgent = agent;
      axiosConfig.proxy = false;
    }

    this.axiosInstance = axios.create(axiosConfig);

    this.rateLimiter = createTrelloRateLimiters();

    this.axiosInstance.interceptors.request.use(async config => {
      await this.rateLimiter.waitForAvailableToken();
      return config;
    });

    if (this.hasWorkspaceRestriction) {
      const guard = new WorkspaceGuard(this.axiosInstance, config.allowedWorkspaceIds!);
      this.guard = guard;
      this.axiosInstance.interceptors.request.use(request => guard.check(request));
    }

    // The one place a request is retried. A 429 is always safe to repeat, because Trello
    // refused it before acting. A 5xx or a lost reply is repeated for a read only: a write
    // may already have happened, so the batch handles its own writes.
    this.axiosInstance.interceptors.response.use(undefined, async error => {
      const config = axios.isAxiosError(error)
        ? (error.config as (InternalAxiosRequestConfig & { retries?: number }) | undefined)
        : undefined;
      const repeatable =
        error?.response?.status === 429 || (config?.method === 'get' && isLostReply(error));
      const attempt = config?.retries ?? 0;
      if (!config || !repeatable || attempt >= MAX_RETRIES) throw error;
      config.retries = attempt + 1;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      return this.axiosInstance.request(config);
    });
  }

  public async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf8');
      const savedConfig = JSON.parse(data);

      // Only the active board and workspace are saved. Credentials always come from the environment.
      if (savedConfig.boardId) {
        this.activeConfig.boardId = savedConfig.boardId;
      }
      if (savedConfig.workspaceId) {
        this.activeConfig.workspaceId = savedConfig.workspaceId;
      }
    } catch (error) {
      // No saved file yet is the normal first run.
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      const configToSave = {
        boardId: this.activeConfig.boardId,
        workspaceId: this.activeConfig.workspaceId,
      };
      await fs.writeFile(CONFIG_FILE, JSON.stringify(configToSave, null, 2));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to save the active board and workspace to ${CONFIG_FILE}: ${reason}`,
        {
          cause: error,
        }
      );
    }
  }

  get activeBoardId(): string | undefined {
    return this.activeConfig.boardId;
  }

  get activeWorkspaceId(): string | undefined {
    return this.activeConfig.workspaceId;
  }

  get hasWorkspaceRestriction(): boolean {
    return (
      this.config.allowedWorkspaceIds !== undefined && this.config.allowedWorkspaceIds.length > 0
    );
  }

  /** The board named, else the active board, which starts as TRELLO_BOARD_ID. */
  private requireBoard(boardId: string | undefined, missing = 'boardId is required'): string {
    const effectiveBoardId = boardId || this.activeConfig.boardId;
    if (!effectiveBoardId) {
      throw new McpError(ErrorCode.InvalidParams, `${missing} when no default board is configured`);
    }
    return effectiveBoardId;
  }

  private isWorkspaceAllowed(workspaceId: string): boolean {
    if (!this.hasWorkspaceRestriction) {
      return true;
    }
    return this.config.allowedWorkspaceIds!.includes(workspaceId);
  }

  private validateWorkspaceAccess(workspaceId: string): void {
    if (!this.isWorkspaceAllowed(workspaceId)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Access to workspace '${workspaceId}' is not allowed. Allowed workspaces: ${this.config.allowedWorkspaceIds!.join(', ')}`
      );
    }
  }

  async setActiveBoard(boardId: string): Promise<TrelloBoard> {
    const board = await this.getBoardById(boardId);
    this.activeConfig.boardId = boardId;
    await this.saveConfig();
    return board;
  }

  /** Validates against allowedWorkspaceIds if configured. */
  async setActiveWorkspace(workspaceId: string): Promise<TrelloWorkspace> {
    this.validateWorkspaceAccess(workspaceId);

    const workspace = await this.getWorkspaceById(workspaceId);
    this.activeConfig.workspaceId = workspaceId;
    await this.saveConfig();
    return workspace;
  }

  // T is unconstrained on purpose: it only threads the caller's return type through.
  // A closed union here excluded every T[] and broke each new return shape.
  private async handleRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      // An McpError already carries the reason, so it passes through unchanged.
      if (error instanceof McpError) throw error;
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          throw new McpError(
            ErrorCode.InternalError,
            `Trello API rate limit exceeded after ${MAX_RETRIES} retries`
          );
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Trello API Error: ${describeError(error)}`,
          error.response?.data
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `An unexpected error occurred: ${reason}`);
    }
  }

  /** With allowedWorkspaceIds configured, only boards in those workspaces come back. */
  async listBoards(): Promise<TrelloBoard[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get('/members/me/boards');
      const boards: TrelloBoard[] = response.data;

      if (this.hasWorkspaceRestriction) {
        return boards.filter(
          board => board.idOrganization && this.isWorkspaceAllowed(board.idOrganization)
        );
      }
      return boards;
    });
  }

  async getBoardById(boardId: string): Promise<TrelloBoard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/boards/${boardId}`);
      return response.data;
    });
  }

  /** With allowedWorkspaceIds configured, only those workspaces come back. */
  async listWorkspaces(): Promise<TrelloWorkspace[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get('/members/me/organizations');
      const workspaces: TrelloWorkspace[] = response.data;

      if (this.hasWorkspaceRestriction) {
        return workspaces.filter(ws => this.isWorkspaceAllowed(ws.id));
      }
      return workspaces;
    });
  }

  async getWorkspaceById(workspaceId: string): Promise<TrelloWorkspace> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/organizations/${workspaceId}`);
      return response.data;
    });
  }

  /** Validates against allowedWorkspaceIds if configured. */
  async listBoardsInWorkspace(workspaceId: string): Promise<TrelloBoard[]> {
    this.validateWorkspaceAccess(workspaceId);

    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/organizations/${workspaceId}/boards`);
      return response.data;
    });
  }

  /** Validates the target workspace against allowedWorkspaceIds if configured. */
  async createBoard(params: {
    name: string;
    desc?: string;
    idOrganization?: string;
    defaultLabels?: boolean;
    defaultLists?: boolean;
  }): Promise<TrelloBoard> {
    const targetWorkspace = params.idOrganization ?? this.activeConfig.workspaceId;

    if (this.hasWorkspaceRestriction) {
      if (!targetWorkspace) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Workspace restrictions are enabled but no workspace was specified. Provide idOrganization or set an active workspace. Allowed workspaces: ${this.config.allowedWorkspaceIds!.join(', ')}`
        );
      }
      this.validateWorkspaceAccess(targetWorkspace);
    }

    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post('/boards', {
        name: params.name,
        desc: params.desc,
        idOrganization: targetWorkspace,
        defaultLabels: params.defaultLabels,
        defaultLists: params.defaultLists,
      });
      return response.data;
    });
  }

  async getCardsByList(
    listId: string,
    fields?: string,
    nameFilter?: string,
    boardId?: string
  ): Promise<TrelloCard[]> {
    await this.checkOnBoard('list', listId, boardId);
    return this.handleRequest(async () => {
      const params = fields ? { fields } : {};
      const response = await this.axiosInstance.get(`/lists/${listId}/cards`, { params });
      let cards: TrelloCard[] = response.data;
      const trimmed = nameFilter?.trim();
      if (trimmed) {
        const searchTerm = trimmed.toLowerCase();
        cards = cards.filter(card => card.name.toLowerCase().includes(searchTerm));
      }
      return cards;
    });
  }

  async getLists(boardId?: string): Promise<TrelloList[]> {
    const effectiveBoardId = this.requireBoard(boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/boards/${effectiveBoardId}/lists`);
      return response.data;
    });
  }

  async getRecentActivity(
    boardId?: string,
    limit: number = 10,
    since?: string,
    before?: string
  ): Promise<TrelloAction[]> {
    const effectiveBoardId = this.requireBoard(boardId);
    return this.handleRequest(async () => {
      const params: Record<string, string | number> = { limit };
      if (since) params.since = since;
      if (before) params.before = before;
      const response = await this.axiosInstance.get(`/boards/${effectiveBoardId}/actions`, {
        params,
      });
      return response.data;
    });
  }

  async addCard(
    boardId: string | undefined,
    params: {
      listId: string;
      name: string;
      description?: string;
      dueDate?: string;
      dueReminder?: number | null;
      start?: string;
      labels?: string[];
    }
  ): Promise<TrelloCard> {
    checkDescription(params.description, this.descriptionLimit);
    checkDates({ dueDate: params.dueDate, start: params.start });
    await this.checkOnBoard('list', params.listId, boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post('/cards', {
        idList: params.listId,
        name: params.name,
        desc: params.description,
        due: params.dueDate,
        dueReminder: params.dueReminder,
        start: params.start,
        idLabels: params.labels,
      });
      return response.data;
    });
  }

  async updateCard(
    boardId: string | undefined,
    params: {
      cardId?: string;
      cardNumber?: number;
      name?: string;
      description?: string;
      dueDate?: string;
      dueReminder?: number | null;
      start?: string;
      dueComplete?: boolean;
      labels?: string[];
      pos?: string | number;
    }
  ): Promise<TrelloCard> {
    checkDescription(params.description, this.descriptionLimit);
    checkDates({ dueDate: params.dueDate, start: params.start });
    const cardId = await this.resolveCardId(params.cardId, params.cardNumber, boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/cards/${cardId}`, {
        name: params.name,
        desc: params.description,
        due: params.dueDate,
        dueReminder: params.dueReminder,
        start: params.start,
        dueComplete: params.dueComplete,
        idLabels: params.labels,
        pos: params.pos,
      });
      return response.data;
    });
  }

  async archiveCard(
    boardId: string | undefined,
    cardId?: string,
    cardNumber?: number
  ): Promise<TrelloCard> {
    const id = await this.resolveCardId(cardId, cardNumber, boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/cards/${id}`, {
        closed: true,
      });
      return response.data;
    });
  }

  /**
   * The card goes to the target list's own board, looked up from the list. Taking the board
   * from anywhere else, as the default board, would send a board the list is not on.
   */
  async moveCard(
    boardId: string | undefined,
    cardId: string,
    listId: string,
    pos?: string | number
  ): Promise<TrelloCard> {
    const found = await this.boardOf('list', listId);
    if (boardId) refuseOtherBoard('list', listId, found, boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/cards/${cardId}`, {
        idList: listId,
        idBoard: found.idBoard,
        ...(pos !== undefined && { pos }),
      });
      return response.data;
    });
  }

  async addList(boardId: string | undefined, name: string): Promise<TrelloList> {
    const effectiveBoardId = this.requireBoard(boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post('/lists', {
        name,
        idBoard: effectiveBoardId,
      });
      return response.data;
    });
  }

  async archiveList(boardId: string | undefined, listId: string): Promise<TrelloList> {
    await this.checkOnBoard('list', listId, boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/lists/${listId}/closed`, {
        value: true,
      });
      return response.data;
    });
  }

  async updateListPosition(listId: string, position: string | number): Promise<TrelloList> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/lists/${listId}/pos`, {
        value: position,
      });
      return response.data;
    });
  }

  async updateList(
    listId: string,
    params: {
      name?: string;
      closed?: boolean;
      subscribed?: boolean;
      idBoard?: string;
    }
  ): Promise<TrelloList> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/lists/${listId}`, params);
      return response.data;
    });
  }

  async watchCard(cardId: string, subscribed: boolean): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/cards/${cardId}`, {
        subscribed,
      });
      return response.data;
    });
  }

  async watchList(listId: string, subscribed: boolean): Promise<TrelloList> {
    return this.updateList(listId, { subscribed });
  }

  async getMyCards(): Promise<TrelloCard[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get('/members/me/cards');
      const cards: TrelloCard[] = response.data;
      const guard = this.guard;
      if (!guard) return cards;
      // The account's cards span every workspace, so keep those on allowed boards only.
      const boards = [...new Set(cards.map(card => card.idBoard))];
      const allowed = new Set<string>();
      for (const board of boards) {
        if (await guard.allowsBoard(board)) allowed.add(board);
      }
      return cards.filter(card => allowed.has(card.idBoard));
    });
  }

  async attachToCard(
    cardId: string,
    source: string,
    name?: string,
    mimeType?: string
  ): Promise<TrelloAttachment> {
    return this.handleRequest(() =>
      attachments.attach(this.axiosInstance, {
        cardId,
        source,
        name,
        mimeType,
        attachRoot: this.config.attachRoot,
      })
    );
  }

  async getCard(cardId: string): Promise<EnhancedTrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/cards/${cardId}`, {
        params: {
          attachments: true,
          checklists: 'all',
          checkItemStates: true,
          members: true,
          membersVoted: true,
          labels: true,
          actions: 'commentCard',
          actions_limit: 100,
          fields: 'all',
          customFieldItems: true,
          list: true,
          board: true,
          stickers: true,
          pluginData: true,
        },
      });

      return response.data;
    });
  }

  /**
   * Turn a card id, or a card number on a board, into a card id. The number is the one
   * Trello shows on the card and the one a branch name carries, as in fix/53-chat-button.
   * A card id with a board given must be a card on that board.
   */
  async resolveCardId(cardId?: string, cardNumber?: number, boardId?: string): Promise<string> {
    if (cardId !== undefined && cardNumber !== undefined) {
      throw new McpError(ErrorCode.InvalidParams, 'Give cardId or cardNumber, not both');
    }
    if (cardId === undefined && cardNumber === undefined) {
      throw new McpError(ErrorCode.InvalidParams, 'Give cardId or cardNumber');
    }
    if (cardId !== undefined) {
      await this.checkOnBoard('card', cardId, boardId);
      return cardId;
    }
    const effectiveBoardId = this.requireBoard(boardId, 'boardId is required with cardNumber');
    try {
      const response = await this.axiosInstance.get(
        `/boards/${effectiveBoardId}/cards/${cardNumber}`,
        { params: { fields: 'id' } }
      );
      return response.data.id;
    } catch (error) {
      if (error instanceof McpError) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 400 || status === 404) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `No card number ${cardNumber} on board ${effectiveBoardId}`
        );
      }
      throw new McpError(ErrorCode.InternalError, `Trello API Error: ${describeError(error)}`);
    }
  }

  /**
   * Refuse a list or a card that is not on the given board. With no board given nothing
   * is checked, so a call that names no board costs no extra request. A board is matched
   * by its id or by the short link in its URL.
   */
  private async checkOnBoard(kind: 'list' | 'card', id: string, boardId?: string): Promise<void> {
    if (!boardId) return;
    refuseOtherBoard(kind, id, await this.boardOf(kind, id), boardId);
  }

  /** The board a list or a card is on, with its short link. */
  private async boardOf(kind: 'list' | 'card', id: string): Promise<OnBoard> {
    try {
      const response = await this.axiosInstance.get(`/${kind}s/${id}`, {
        params: { fields: 'idBoard', board: true, board_fields: 'shortLink' },
      });
      return response.data;
    } catch (error) {
      if (error instanceof McpError) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 400 || status === 404) {
        throw new McpError(ErrorCode.InvalidParams, `No ${kind} ${id}`);
      }
      throw new McpError(ErrorCode.InternalError, `Trello API Error: ${describeError(error)}`);
    }
  }

  /** Add one label to a card and leave the others as they are. */
  async addLabelToCard(
    cardId: string,
    labelId: string
  ): Promise<{ cardId: string; idLabels: string[] }> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post(`/cards/${cardId}/idLabels`, {
        value: labelId,
      });
      return { cardId, idLabels: response.data };
    });
  }

  /** Remove one label from a card and leave the others as they are. */
  async removeLabelFromCard(
    cardId: string,
    labelId: string
  ): Promise<{ cardId: string; removed: string }> {
    return this.handleRequest(async () => {
      await this.axiosInstance.delete(`/cards/${cardId}/idLabels/${labelId}`);
      return { cardId, removed: labelId };
    });
  }

  /**
   * Search card names and descriptions. With TRELLO_ALLOWED_WORKSPACES set, Trello is
   * asked to search those workspaces only, so a card elsewhere never comes back, and the
   * workspace guard refuses a boardId outside them.
   */
  async searchCards(query: string, boardId?: string, limit: number = 20): Promise<TrelloCard[]> {
    if (!query.trim()) {
      throw new McpError(ErrorCode.InvalidParams, 'query must not be empty');
    }
    return this.handleRequest(async () => {
      const params: Record<string, string | number | boolean> = {
        query,
        modelTypes: 'cards',
        card_fields: 'name,idShort,idBoard,idList,shortUrl,closed,due,dateLastActivity',
        cards_limit: limit,
        partial: true,
      };
      if (boardId) params.idBoards = boardId;
      else if (this.hasWorkspaceRestriction) {
        params.idOrganizations = this.config.allowedWorkspaceIds!.join(',');
      }
      const response = await this.axiosInstance.get('/search', { params });
      return response.data.cards ?? [];
    });
  }

  // The comment text goes in the body. In the URL, a long comment runs past the length a
  // server accepts, and the text would land in every proxy and access log on the way.
  async addCommentToCard(cardId: string, text: string): Promise<TrelloComment> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post(`/cards/${cardId}/actions/comments`, {
        text,
      });
      return response.data;
    });
  }

  async updateCommentOnCard(commentId: string, text: string): Promise<boolean> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/actions/${commentId}`, { text });
      return response.status >= 200 && response.status < 300;
    });
  }

  async deleteCommentFromCard(commentId: string): Promise<boolean> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.delete(`/actions/${commentId}`);
      return response.status >= 200 && response.status < 300;
    });
  }

  async getCardComments(cardId: string, limit: number = 100): Promise<TrelloComment[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/cards/${cardId}/actions`, {
        params: {
          filter: 'commentCard',
          limit: limit,
        },
      });
      return response.data;
    });
  }

  // Checklists. The rules are in checklists.ts. A board left out means the active board.
  async getChecklistItems(
    name: string,
    cardId?: string,
    boardId?: string
  ): Promise<CheckListItem[]> {
    return this.handleRequest(() =>
      checklists.getItems(this.axiosInstance, name, cardId, boardId || this.activeConfig.boardId)
    );
  }

  async addChecklistItem(
    text: string,
    checkListName: string,
    cardId?: string,
    boardId?: string
  ): Promise<CheckListItem> {
    return this.handleRequest(() =>
      checklists.addItem(
        this.axiosInstance,
        text,
        checkListName,
        cardId,
        boardId || this.activeConfig.boardId
      )
    );
  }

  async findChecklistItemsByDescription(
    description: string,
    cardId?: string,
    boardId?: string
  ): Promise<CheckListItem[]> {
    return this.handleRequest(() =>
      checklists.findItems(
        this.axiosInstance,
        description,
        cardId,
        boardId || this.activeConfig.boardId
      )
    );
  }

  async getAcceptanceCriteria(
    cardId?: string,
    boardId?: string
  ): Promise<AcceptanceCriteriaResult> {
    return this.handleRequest(() =>
      checklists.acceptanceCriteria(
        this.axiosInstance,
        cardId,
        boardId || this.activeConfig.boardId
      )
    );
  }

  async createChecklist(
    name: string,
    cardId: string,
    items: string[] = []
  ): Promise<TrelloChecklist> {
    return this.handleRequest(() => checklists.create(this.axiosInstance, name, cardId, items));
  }

  async getChecklistByName(
    name: string,
    cardId?: string,
    boardId?: string
  ): Promise<CheckList | null> {
    return this.handleRequest(() =>
      checklists.byName(this.axiosInstance, name, cardId, boardId || this.activeConfig.boardId)
    );
  }

  async updateChecklistItem(
    cardId: string,
    checkItemId: string,
    updates: TrelloCheckItemUpdate | TrelloCheckItem['state']
  ): Promise<TrelloCheckItem> {
    const normalizedUpdates = typeof updates === 'string' ? { state: updates } : updates;
    checkDates({ due: normalizedUpdates.due });
    const payload = Object.fromEntries(
      Object.entries(normalizedUpdates).filter(([, value]) => value !== undefined)
    ) as TrelloCheckItemUpdate;

    if (Object.keys(payload).length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'At least one checklist item field must be provided'
      );
    }

    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put<TrelloCheckItem>(
        `/cards/${cardId}/checkItem/${checkItemId}`,
        payload
      );
      return response.data;
    });
  }

  async deleteChecklistItem(cardId: string, checkItemId: string): Promise<boolean> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.delete(`/cards/${cardId}/checkItem/${checkItemId}`);
      return response.status >= 200 && response.status < 300;
    });
  }

  async getBoardMembers(boardId?: string): Promise<TrelloMember[]> {
    const effectiveBoardId = this.requireBoard(boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/boards/${effectiveBoardId}/members`);
      return response.data;
    });
  }

  /** Trello replies with the members on the card, the new member included. */
  async assignMemberToCard(cardId: string, memberId: string): Promise<TrelloMember[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post(`/cards/${cardId}/idMembers`, {
        value: memberId,
      });
      return response.data;
    });
  }

  /** Trello replies with the members that stay on the card. */
  async removeMemberFromCard(cardId: string, memberId: string): Promise<TrelloMember[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.delete(`/cards/${cardId}/idMembers/${memberId}`);
      return response.data;
    });
  }

  async getBoardLabels(boardId?: string): Promise<TrelloLabelDetails[]> {
    const effectiveBoardId = this.requireBoard(boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/boards/${effectiveBoardId}/labels`);
      return response.data;
    });
  }

  async createLabel(
    boardId: string | undefined,
    name: string,
    color?: string
  ): Promise<TrelloLabelDetails> {
    const effectiveBoardId = this.requireBoard(boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post(`/boards/${effectiveBoardId}/labels`, {
        name,
        color,
      });
      return response.data;
    });
  }

  async updateLabel(labelId: string, name?: string, color?: string): Promise<TrelloLabelDetails> {
    return this.handleRequest(async () => {
      const updateData: { name?: string; color?: string } = {};
      if (name !== undefined) updateData.name = name;
      if (color !== undefined) updateData.color = color;

      const response = await this.axiosInstance.put(`/labels/${labelId}`, updateData);
      return response.data;
    });
  }

  async deleteLabel(labelId: string): Promise<boolean> {
    return this.handleRequest(async () => {
      await this.axiosInstance.delete(`/labels/${labelId}`);
      return true;
    });
  }

  /** Copies across boards too. Trello clones the card named by idCardSource. */
  async copyCard(params: {
    sourceCardId: string;
    listId: string;
    name?: string;
    description?: string;
    keepFromSource?: string;
    pos?: string;
  }): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post('/cards', {
        idCardSource: params.sourceCardId,
        idList: params.listId,
        name: params.name,
        desc: params.description,
        keepFromSource: params.keepFromSource || 'all',
        pos: params.pos,
      });
      return response.data;
    });
  }

  /** Copies across boards too. */
  async copyChecklist(params: {
    sourceChecklistId: string;
    cardId: string;
    name?: string;
    pos?: string;
  }): Promise<TrelloChecklist> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post('/checklists', {
        idCard: params.cardId,
        idChecklistSource: params.sourceChecklistId,
        name: params.name,
        pos: params.pos,
      });
      return response.data;
    });
  }

  /** Add up to 50 cards to a list in order. The rules are in batch.ts. */
  async batchAddCards(listId: string, cards: BatchCard[]): Promise<BatchAddCardsResult> {
    return batch.addCards(this.axiosInstance, listId, cards, this.descriptionLimit);
  }

  async getBoardCustomFields(boardId?: string): Promise<TrelloCustomFieldDefinition[]> {
    const effectiveBoardId = this.requireBoard(boardId);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/boards/${effectiveBoardId}/customFields`);
      return response.data;
    });
  }

  async getCustomFieldOptions(customFieldId: string): Promise<TrelloCustomFieldOption[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/customFields/${customFieldId}/options`);
      return response.data;
    });
  }

  async updateCardCustomField(
    cardId: string,
    customFieldId: string,
    params: {
      type: 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'clear';
      value?: string;
    }
  ): Promise<TrelloCustomFieldItem> {
    return this.handleRequest(async () => {
      let body: Record<string, unknown>;

      if (params.type === 'clear') {
        body = { value: '', idValue: '' };
      } else if (params.type === 'list') {
        body = { idValue: params.value };
      } else if (params.type === 'text') {
        body = { value: { text: params.value } };
      } else if (params.type === 'number') {
        body = { value: { number: params.value } };
      } else if (params.type === 'checkbox') {
        body = { value: { checked: params.value } };
      } else if (params.type === 'date') {
        body = { value: { date: params.value } };
      } else {
        // Defensive: unreachable with current type union, guards against future additions
        throw new McpError(ErrorCode.InvalidParams, `Unknown custom field type: ${params.type}`);
      }

      const response = await this.axiosInstance.put(
        `/cards/${cardId}/customField/${customFieldId}/item`,
        body
      );
      return response.data;
    });
  }

  async getCardHistory(cardId: string, filter?: string, limit?: number): Promise<TrelloAction[]> {
    return this.handleRequest(async () => {
      const params: { filter?: string; limit?: number } = {};
      if (filter) params.filter = filter;
      if (limit) params.limit = limit;

      const response = await this.axiosInstance.get(`/cards/${cardId}/actions`, { params });
      return response.data;
    });
  }

  /** An uploaded attachment's bytes, as base64, with its type and file name. */
  async downloadAttachment(
    cardId: string,
    attachmentId: string
  ): Promise<{ data: string; mimeType: string; fileName: string }> {
    return this.handleRequest(async () => {
      const metaResponse = await this.axiosInstance.get(
        `/cards/${cardId}/attachments/${attachmentId}`
      );
      const attachment = metaResponse.data;
      if (!attachment.isUpload) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Attachment ${attachmentId} is a link to ${attachment.url}, not a file stored on Trello, so there is nothing to download.`
        );
      }
      const maxBytes = Math.round(this.maxDownloadMb * 1024 * 1024);
      const tooLarge = (size: string) =>
        new McpError(
          ErrorCode.InvalidParams,
          `Attachment ${attachmentId} (${attachment.fileName}) is ${size}, over the ${this.maxDownloadMb} MB download limit set by TRELLO_MAX_DOWNLOAD_MB. Nothing was downloaded. Open it at ${attachment.url}, or tell the user, who can raise the limit.`
        );
      if (typeof attachment.bytes === 'number' && attachment.bytes > maxBytes) {
        throw tooLarge(`${(attachment.bytes / 1024 / 1024).toFixed(1)} MB`);
      }

      // Trello serves an uploaded file only with the OAuth header, not the key and token.
      const downloadUrl = `https://api.trello.com/1/cards/${cardId}/attachments/${attachmentId}/download/${encodeURIComponent(attachment.fileName)}`;
      // The size in the metadata can be missing, so the download itself stops at the limit too.
      const response = await this.axiosInstance
        .get(downloadUrl, {
          maxContentLength: maxBytes,
          headers: {
            Authorization:
              'OAuth oauth_consumer_key="' +
              this.config.apiKey +
              '", oauth_token="' +
              this.config.token +
              '"',
          },
          responseType: 'arraybuffer',
        })
        .catch(error => {
          if (axios.isAxiosError(error) && error.code === 'ERR_BAD_RESPONSE' && !error.response) {
            throw tooLarge('larger than the limit');
          }
          throw error;
        });

      const base64Data = Buffer.from(response.data).toString('base64');

      return {
        data: base64Data,
        mimeType: attachment.mimeType || 'application/octet-stream',
        fileName: attachment.fileName || 'attachment',
      };
    });
  }
}

type OnBoard = { idBoard: string; board?: { shortLink?: string } };

/** A board is matched by its id or by the short link in its URL. */
function refuseOtherBoard(kind: 'list' | 'card', id: string, found: OnBoard, boardId: string) {
  if (boardId !== found.idBoard && boardId !== found.board?.shortLink) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `The ${kind} ${id} is on board ${found.idBoard}, not on board ${boardId}. Nothing was done.`
    );
  }
}

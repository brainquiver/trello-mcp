import { AxiosInstance } from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  AcceptanceCriteriaResult,
  CheckList,
  CheckListItem,
  EnhancedTrelloCard,
  TrelloCheckItem,
  TrelloChecklist,
} from './types.js';
import { describeError } from './errors.js';

/**
 * Checklist names recognized as acceptance criteria, in precedence order.
 * Matching is case-insensitive, whitespace-trimmed, exact equality, never fuzzy.
 */
export const ACCEPTANCE_CRITERIA_ALIASES = [
  'Acceptance Criteria',
  'AC',
  'DoD',
  'Definition of Done',
] as const;

/**
 * Every checklist in scope: one card when cardId is given, otherwise the whole board. The
 * client passes the board already resolved, the active board when none was named.
 */
async function checklistsInScope(
  axiosInstance: AxiosInstance,
  cardId?: string,
  boardId?: string
): Promise<TrelloChecklist[]> {
  if (cardId) {
    const cardResponse = await axiosInstance.get<EnhancedTrelloCard>(`/cards/${cardId}`, {
      params: { checklists: 'all' },
    });
    return cardResponse.data.checklists || [];
  }
  if (!boardId) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'No board ID or card ID provided and no active board set'
    );
  }
  const response = await axiosInstance.get<TrelloChecklist[]>(`/boards/${boardId}/checklists`);
  return response.data || [];
}

export async function getItems(
  axiosInstance: AxiosInstance,
  name: string,
  cardId?: string,
  boardId?: string
): Promise<CheckListItem[]> {
  const checklists = await checklistsInScope(axiosInstance, cardId, boardId);

  const allCheckItems: CheckListItem[] = [];

  for (const checklist of checklists) {
    if (checklist.name.toLowerCase() === name.toLowerCase()) {
      const convertedItems = checklist.checkItems.map(item => toItem(item, checklist.id));
      allCheckItems.push(...convertedItems);
    }
  }

  return allCheckItems;
}

export async function addItem(
  axiosInstance: AxiosInstance,
  text: string,
  checkListName: string,
  cardId?: string,
  boardId?: string
): Promise<CheckListItem> {
  const checklists = await checklistsInScope(axiosInstance, cardId, boardId);

  const targetChecklist = checklists.find(
    checklist => checklist.name.toLowerCase() === checkListName.toLowerCase()
  );

  if (!targetChecklist) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Checklist "${checkListName}" not found${cardId ? ' on card' : ' on board'}`
    );
  }

  const itemResponse = await axiosInstance.post<TrelloCheckItem>(
    `/checklists/${targetChecklist.id}/checkItems`,
    {
      name: text,
    }
  );

  return toItem(itemResponse.data, targetChecklist.id);
}

export async function findItems(
  axiosInstance: AxiosInstance,
  description: string,
  cardId?: string,
  boardId?: string
): Promise<CheckListItem[]> {
  const checklists = await checklistsInScope(axiosInstance, cardId, boardId);

  const matchingItems: CheckListItem[] = [];
  const searchTerm = description.toLowerCase();

  for (const checklist of checklists) {
    for (const checkItem of checklist.checkItems) {
      if (checkItem.name.toLowerCase().includes(searchTerm)) {
        matchingItems.push(toItem(checkItem, checklist.id));
      }
    }
  }

  return matchingItems;
}

/**
 * Read the acceptance criteria for a card (or board), tolerating the common
 * checklist headings teams actually use: "Acceptance Criteria", "AC", "DoD",
 * "Definition of Done", matched case-insensitively after trimming.
 *
 * Deterministic tie-break: the first alias in precedence order that has any match
 * wins; items from every checklist matching that winning alias are aggregated in
 * API order; `matchedChecklistName` reports the board's own spelling of the first
 * such checklist. When nothing matches, the caller gets an explicit not-found plus
 * the checklist names that do exist, never a silent empty list.
 */
export async function acceptanceCriteria(
  axiosInstance: AxiosInstance,
  cardId?: string,
  boardId?: string
): Promise<AcceptanceCriteriaResult> {
  const checklists = await checklistsInScope(axiosInstance, cardId, boardId);
  const normalize = (name: string) => name.trim().toLowerCase();

  for (const alias of ACCEPTANCE_CRITERIA_ALIASES) {
    const matching = checklists.filter(
      checklist => normalize(checklist.name || '') === normalize(alias)
    );
    if (matching.length === 0) continue;

    const items = matching.flatMap(checklist =>
      (checklist.checkItems || []).map(item => toItem(item, checklist.id))
    );
    const completeCount = items.filter(item => item.complete).length;

    return {
      found: true,
      items,
      percentComplete: items.length === 0 ? 0 : Math.round((completeCount / items.length) * 100),
      unmet: items.filter(item => !item.complete),
      matchedChecklistName: matching[0].name,
    };
  }

  const scope = cardId ? 'card' : 'board';
  const triedAliases = ACCEPTANCE_CRITERIA_ALIASES.map(alias => `"${alias}"`).join(', ');
  return {
    found: false,
    reason:
      `No checklist on this ${scope} matched a recognized acceptance-criteria name. ` +
      `Tried (case-insensitive): ${triedAliases}. ` +
      `Rename an existing checklist to one of those names, or create one, to make its criteria readable here.`,
    availableChecklists: checklists.map(checklist => checklist.name),
  };
}

export async function create(
  axiosInstance: AxiosInstance,
  name: string,
  cardId: string,
  items: string[] = []
): Promise<TrelloChecklist> {
  if (!cardId) {
    throw new McpError(ErrorCode.InvalidParams, 'cardId is required');
  }
  const response = await axiosInstance.post<TrelloChecklist>(`/cards/${cardId}/checklists`, {
    name,
  });
  const checklist = response.data;
  const checkItems: TrelloCheckItem[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      const item = await axiosInstance.post<TrelloCheckItem>(
        `/checklists/${checklist.id}/checkItems`,
        { name: items[i] }
      );
      checkItems.push(item.data);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Checklist "${name}" was created with ${i} of ${items.length} items. Item ${i + 1} ("${items[i]}") failed: ${describeError(error)}. Add the rest with add_checklist_item.`
      );
    }
  }
  return { ...checklist, checkItems: [...(checklist.checkItems ?? []), ...checkItems] };
}

export async function byName(
  axiosInstance: AxiosInstance,
  name: string,
  cardId?: string,
  boardId?: string
): Promise<CheckList | null> {
  const checklists = await checklistsInScope(axiosInstance, cardId, boardId);

  const targetChecklist = checklists.find(
    checklist => checklist.name.toLowerCase() === name.toLowerCase()
  );

  if (targetChecklist) {
    return toChecklist(targetChecklist);
  }

  return null;
}

// Trello's checklist shapes turned into the smaller ones the tools return.
function toItem(trelloItem: TrelloCheckItem, parentCheckListId: string): CheckListItem {
  return {
    id: trelloItem.id,
    text: trelloItem.name,
    complete: trelloItem.state === 'complete',
    parentCheckListId,
  };
}

function toChecklist(trelloChecklist: TrelloChecklist): CheckList {
  const completedItems = trelloChecklist.checkItems.filter(
    item => item.state === 'complete'
  ).length;
  const totalItems = trelloChecklist.checkItems.length;
  const percentComplete = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return {
    id: trelloChecklist.id,
    name: trelloChecklist.name,
    items: trelloChecklist.checkItems.map(item => toItem(item, trelloChecklist.id)),
    percentComplete,
  };
}

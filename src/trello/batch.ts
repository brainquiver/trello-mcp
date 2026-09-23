import axios, { AxiosInstance } from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TrelloCard } from './types.js';
import { MAX_RETRIES, describeError, isLostReply } from './errors.js';
import { ISO_DATE, descriptionLength } from './validation.js';

export const BATCH_LIMIT = 50;

/**
 * Add cards to a list in order. Trello has no batch write, so each card is its own POST.
 *
 * Every card is checked before the first write, so bad input creates nothing. A
 * temporary fault (429, a 5xx, no reply) is retried. Any other failure stops the batch,
 * and the result names the cards created and the cards not created.
 */
export async function addCards(
  axiosInstance: AxiosInstance,
  listId: string,
  cards: BatchCard[],
  descriptionLimit: number
): Promise<BatchAddCardsResult> {
  if (cards.length > BATCH_LIMIT) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Cannot create more than ${BATCH_LIMIT} cards at once (got ${cards.length})`
    );
  }
  if (cards.length === 0) return { created: [] };

  const known = await checkBatch(axiosInstance, listId, cards, descriptionLimit);
  const created: TrelloCard[] = [];
  for (let i = 0; i < cards.length; i++) {
    try {
      const card = await createBatchCard(axiosInstance, listId, cards[i], known);
      known.add(card.id);
      created.push(card);
    } catch (error) {
      const uncertain = error instanceof BatchCardError && error.uncertain;
      const reason = error instanceof BatchCardError ? error.message : describeError(error);
      return {
        created,
        stopped: {
          card: i + 1,
          name: cards[i].name,
          reason,
          uncertain,
          message: stopMessage(i, cards.length, cards[i].name, reason, uncertain),
        },
      };
    }
  }
  return { created };
}

/**
 * Check the whole batch before any write. Returns the ids of the cards already in
 * the list, which the duplicate check needs.
 */
async function checkBatch(
  axiosInstance: AxiosInstance,
  listId: string,
  cards: BatchCard[],
  descriptionLimit: number
): Promise<Set<string>> {
  // Offline first: a bad date or an overlong description needs no request to find.
  const problems: string[] = [];
  cards.forEach((card, i) => {
    const length = descriptionLength(card.description);
    if (length > descriptionLimit) {
      problems.push(
        `card ${i + 1} "${card.name}": description is ${length} characters, ${length - descriptionLimit} over the ${descriptionLimit} limit`
      );
    }
    for (const [field, value] of [
      ['dueDate', card.dueDate],
      ['start', card.start],
    ] as const) {
      if (value !== undefined && !(ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)))) {
        problems.push(`card ${i + 1} "${card.name}": ${field} "${value}" is not an ISO 8601 date`);
      }
    }
  });
  if (problems.length) throw fixAndResend(problems);

  let boardId: string;
  try {
    const list = await axiosInstance.get(`/lists/${listId}`, {
      params: { fields: 'idBoard' },
    });
    boardId = list.data.idBoard;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 400 || status === 404) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `List ${listId} does not exist. No cards were created.`
      );
    }
    throw nothingCreated(error);
  }

  if (cards.some(card => card.labels?.length)) {
    const labels = await axiosInstance
      .get(`/boards/${boardId}/labels`, { params: { fields: 'id', limit: 1000 } })
      .catch(error => {
        throw nothingCreated(error);
      });
    const onBoard = new Set((labels.data as Array<{ id: string }>).map(label => label.id));
    cards.forEach((card, i) => {
      for (const label of card.labels ?? []) {
        if (!onBoard.has(label)) {
          problems.push(`card ${i + 1} "${card.name}": label ${label} is not on this board`);
        }
      }
    });
  }

  if (problems.length) throw fixAndResend(problems);

  const existing = await axiosInstance
    .get(`/lists/${listId}/cards`, { params: { fields: 'id' } })
    .catch(error => {
      throw nothingCreated(error);
    });
  return new Set((existing.data as Array<{ id: string }>).map(card => card.id));
}

/**
 * Create one card. The interceptor already repeats a 429. A 5xx or a lost reply may
 * have come after Trello created the card, so before the next attempt the list is
 * searched for a new card of that name. Posting again blind would make a duplicate.
 */
async function createBatchCard(
  axiosInstance: AxiosInstance,
  listId: string,
  card: BatchCard,
  known: Set<string>
): Promise<TrelloCard> {
  let uncertain = false;
  for (let attempt = 0; ; attempt++) {
    if (uncertain) {
      let found: TrelloCard | undefined;
      try {
        found = await findNewCard(axiosInstance, listId, card.name, known);
      } catch (error) {
        throw new BatchCardError(describeError(error), true);
      }
      if (found) return found;
    }
    try {
      const response = await axiosInstance.post('/cards', {
        idList: listId,
        name: card.name,
        desc: card.description,
        due: card.dueDate,
        start: card.start,
        idLabels: card.labels,
      });
      return response.data;
    } catch (error) {
      uncertain = isLostReply(error);
      if (!uncertain || attempt >= MAX_RETRIES) {
        throw new BatchCardError(describeError(error), uncertain);
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

async function findNewCard(
  axiosInstance: AxiosInstance,
  listId: string,
  name: string,
  known: Set<string>
): Promise<TrelloCard | undefined> {
  const response = await axiosInstance.get(`/lists/${listId}/cards`, {
    params: { fields: 'name' },
  });
  const match = (response.data as Array<{ id: string; name: string }>).find(
    card => card.name === name && !known.has(card.id)
  );
  if (!match) return undefined;
  const full = await axiosInstance.get(`/cards/${match.id}`);
  return full.data;
}

export interface BatchCard {
  name: string;
  description?: string;
  dueDate?: string;
  start?: string;
  labels?: string[];
}

export interface BatchAddCardsResult {
  created: TrelloCard[];
  stopped?: {
    card: number;
    name: string;
    reason: string;
    uncertain: boolean;
    message: string;
  };
}

class BatchCardError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean
  ) {
    super(message);
  }
}

function fixAndResend(problems: string[]): McpError {
  return new McpError(
    ErrorCode.InvalidParams,
    `No cards were created. Fix these and send the batch again:\n${problems.join('\n')}`
  );
}

function nothingCreated(error: unknown): McpError {
  return new McpError(ErrorCode.InternalError, `${describeError(error)}. No cards were created.`);
}

function cardsPhrase(from: number, to: number, verb: string): string {
  if (from === to) return `Card ${from} was ${verb}.`;
  const joiner = to === from + 1 ? 'and' : 'to';
  return `Cards ${from} ${joiner} ${to} were ${verb}.`;
}

function stopMessage(
  index: number,
  total: number,
  name: string,
  reason: string,
  uncertain: boolean
): string {
  const at = index + 1;
  const parts = [`Stopped at card ${at} of ${total} ("${name}"): ${reason}.`];
  if (uncertain) {
    if (index > 0) parts.push(cardsPhrase(1, index, 'created'));
    parts.push(
      `Card ${at} may have been created: Trello did not reply and it could not be confirmed. Check the list.`
    );
    if (at < total) parts.push(cardsPhrase(at + 1, total, 'not created'));
  } else if (index === 0) {
    parts.push('No cards were created.');
  } else {
    parts.push(cardsPhrase(1, index, 'created'));
    parts.push(cardsPhrase(at, total, 'not created'));
  }
  parts.push('Ask the user how to resolve this before retrying.');
  return parts.join(' ');
}

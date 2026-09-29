import { describe, it, expect } from 'vitest';
import { formatCardAsMarkdown } from '../../../src/reply/markdown.js';
import type { EnhancedTrelloCard } from '../../../src/trello/types.js';

const card = {
  id: 'c1',
  name: 'Chat button',
  desc: 'Add a chat button. ![mock](https://t/mock.png)',
  due: '2026-10-01T12:00:00.000Z',
  dueComplete: false,
  url: 'https://trello.com/c/Ab/53-chat-button',
  shortUrl: 'https://trello.com/c/Ab',
  dateLastActivity: '2026-09-23T10:00:00.000Z',
  board: { id: 'b1', name: 'Product', url: 'https://trello.com/b/p' },
  list: { id: 'l1', name: 'Doing' },
  labels: [
    { id: 'x1', name: 'blocked', color: 'red' },
    { id: 'x2', name: '', color: 'blue' },
  ],
  members: [{ id: 'm1', username: 'ada', fullName: 'Ada L' }],
  checklists: [
    {
      id: 'k1',
      name: 'Acceptance Criteria',
      checkItems: [
        { id: 'i2', name: 'Second', state: 'incomplete', pos: 2, idMember: 'm1' },
        { id: 'i1', name: 'First', state: 'complete', pos: 1 },
      ],
    },
  ],
  attachments: [
    {
      id: 'a1',
      name: 'shot.png',
      url: 'https://t/shot.png',
      fileName: 'shot.png',
      bytes: 2048,
      mimeType: 'image/png',
      date: '2026-09-23T10:00:00.000Z',
    },
  ],
  // Trello sends a card's comments as actions of type commentCard.
  actions: [
    {
      id: 'ac1',
      type: 'commentCard',
      date: '2026-09-23T11:00:00.000Z',
      data: { text: 'Looks good to me.' },
      memberCreator: { id: 'm1', fullName: 'Ada L', username: 'ada' },
    },
  ],
  badges: { checkItems: 2, checkItemsChecked: 1, comments: 1, attachments: 1, votes: 0 },
} as unknown as EnhancedTrelloCard;

describe('formatCardAsMarkdown', () => {
  const markdown = formatCardAsMarkdown(card);

  it('should give every date as ISO 8601 in UTC, whatever the locale of the machine', () => {
    expect(markdown).toContain('Due: 2026-10-01T12:00:00.000Z');
    expect(markdown).toContain('- **Added**: 2026-09-23T10:00:00.000Z');
    expect(markdown).toContain('(@ada) - 2026-09-23T11:00:00.000Z');
    expect(markdown).toContain('*Last Activity: 2026-09-23T10:00:00.000Z*');
  });

  it('should open with the card name and where it sits', () => {
    expect(markdown.startsWith('# Chat button\n\n')).toBe(true);
    expect(markdown).toContain('**Board**: [Product](https://trello.com/b/p) > **List**: Doing');
  });

  it('should list labels, naming an unnamed one', () => {
    expect(markdown).toContain('## Labels\n- `red` blocked\n- `blue` (no name)\n');
  });

  it('should list members and the inline images in the description', () => {
    expect(markdown).toContain('- @ada (Ada L)');
    expect(markdown).toContain('### Inline Images in Description\n1. mock: https://t/mock.png');
  });

  it('should show checklist progress, in position order, with the assigned member', () => {
    expect(markdown).toContain('### Acceptance Criteria (1/2)\n- [x] First\n- [ ] Second - @ada\n');
  });

  it('should show an attachment with its size in readable units', () => {
    expect(markdown).toContain('### 1. shot.png\n- **URL**: https://t/shot.png');
    expect(markdown).toContain('- **File**: shot.png (2 KB)');
  });

  it('should show the comments, which Trello sends as actions', () => {
    expect(markdown).toContain('## Comments (1)\n### Ada L (@ada) - ');
    expect(markdown).toContain('Looks good to me.\n');
  });

  it('should leave the comments section out when there are none', () => {
    const quiet = formatCardAsMarkdown({ ...card, actions: [] } as EnhancedTrelloCard);
    expect(quiet).not.toContain('## Comments');
  });

  it('should end with the links and the card id', () => {
    expect(markdown).toContain('- **Short URL**: https://trello.com/c/Ab');
    expect(markdown.trimEnd().endsWith('*Card ID: c1*')).toBe(true);
  });

  it('should be plain keyboard text, with no emoji', () => {
    expect(markdown).toMatch(/^[\x20-\x7E\n]*$/);
  });
});

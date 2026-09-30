import { describe, it, expect } from 'vitest';
import * as shape from '../../../src/reply/shape.js';

// A card as get_card receives it: every field, and the nested board, list and more.
const fullCard = {
  id: 'c1',
  idShort: 53,
  name: 'Chat button',
  desc: 'Add a chat button.',
  descData: { emoji: {} },
  due: null,
  dueComplete: false,
  dueReminder: null,
  start: null,
  closed: false,
  pos: 16384,
  idBoard: 'b1',
  idList: 'l1',
  idLabels: ['x1'],
  idMembers: ['m1'],
  idMembersVoted: [],
  idChecklists: ['k1'],
  idAttachmentCover: null,
  dateLastActivity: '2026-09-23T10:00:00.000Z',
  shortLink: 'AbCd1234',
  shortUrl: 'https://trello.com/c/AbCd1234',
  url: 'https://trello.com/c/AbCd1234/53-chat-button',
  subscribed: false,
  manualCoverAttachment: false,
  cover: { idAttachment: null, color: null, size: 'normal', brightness: 'dark' },
  badges: { votes: 0, comments: 1, attachments: 1, checkItems: 2, checkItemsChecked: 1 },
  limits: { attachments: { perCard: { status: 'ok', disableAt: 1000, warnAt: 800 } } },
  labels: [{ id: 'x1', idBoard: 'b1', name: 'blocked', color: 'red', uses: 3, nodeId: 'n' }],
  members: [
    { id: 'm1', username: 'ada', fullName: 'Ada L', avatarUrl: 'https://a', initials: 'AL' },
  ],
  list: { id: 'l1', name: 'Doing', closed: false, idBoard: 'b1', pos: 1, subscribed: false },
  board: { id: 'b1', name: 'Product', prefs: { background: 'blue' }, labelNames: {} },
  checklists: [
    {
      id: 'k1',
      name: 'Acceptance Criteria',
      idCard: 'c1',
      idBoard: 'b1',
      pos: 1,
      checkItems: [
        {
          id: 'i1',
          name: 'Button shows',
          state: 'complete',
          pos: 1,
          due: null,
          idMember: null,
          idChecklist: 'k1',
          nameData: {},
        },
      ],
    },
  ],
  attachments: [
    {
      id: 'a1',
      name: 'shot.png',
      url: 'https://t/shot.png',
      mimeType: 'image/png',
      bytes: 42,
      date: 'd',
      isUpload: true,
      previews: [{ url: 'p1' }, { url: 'p2' }],
      edgeColor: '#fff',
    },
  ],
  actions: [
    {
      id: 'ac1',
      type: 'commentCard',
      date: 'd',
      data: { text: 'Looks good', card: { id: 'c1' } },
      memberCreator: { id: 'm1', username: 'ada', fullName: 'Ada L', avatarHash: 'h' },
      display: { entities: {} },
      limits: {},
    },
  ],
  customFieldItems: [],
  stickers: [],
  pluginData: [{ id: 'p', value: '{}' }],
};

describe('shape', () => {
  it('should keep what an agent reads on a card, under Trello names', () => {
    expect(shape.card(fullCard)).toEqual({
      id: 'c1',
      idShort: 53,
      name: 'Chat button',
      desc: 'Add a chat button.',
      due: null,
      dueComplete: false,
      start: null,
      closed: false,
      pos: 16384,
      idBoard: 'b1',
      idList: 'l1',
      dateLastActivity: '2026-09-23T10:00:00.000Z',
      shortUrl: 'https://trello.com/c/AbCd1234',
      labels: [{ id: 'x1', idBoard: 'b1', name: 'blocked', color: 'red' }],
      members: [{ id: 'm1', username: 'ada', fullName: 'Ada L' }],
      list: { id: 'l1', name: 'Doing' },
      board: { id: 'b1', name: 'Product' },
      checklists: [
        {
          id: 'k1',
          name: 'Acceptance Criteria',
          idCard: 'c1',
          pos: 1,
          checkItems: [
            {
              id: 'i1',
              name: 'Button shows',
              state: 'complete',
              pos: 1,
              due: null,
              idMember: null,
              idChecklist: 'k1',
            },
          ],
        },
      ],
      attachments: [
        {
          id: 'a1',
          name: 'shot.png',
          url: 'https://t/shot.png',
          mimeType: 'image/png',
          bytes: 42,
          date: 'd',
          isUpload: true,
        },
      ],
      comments: [
        {
          id: 'ac1',
          date: 'd',
          text: 'Looks good',
          member: { id: 'm1', username: 'ada', fullName: 'Ada L' },
        },
      ],
    });
  });

  it('should make a full card reply much smaller', () => {
    const before = JSON.stringify(fullCard, null, 2).length;
    const after = JSON.stringify(shape.card(fullCard)).length;
    expect(after).toBeLessThan(before / 2);
  });

  it('should keep ids when a card comes without its nested labels and members', () => {
    expect(shape.card({ id: 'c1', name: 'A', idLabels: ['x1'], idMembers: ['m1'] })).toEqual({
      id: 'c1',
      name: 'A',
      idLabels: ['x1'],
      idMembers: ['m1'],
    });
  });

  it('should keep custom field values when a card has some', () => {
    const shaped = shape.card({
      id: 'c1',
      customFieldItems: [
        { id: 'cf', idCustomField: 'f1', idModel: 'c1', value: { text: 'x' }, idValue: null },
      ],
    }) as { customFieldItems: unknown };
    expect(shaped.customFieldItems).toEqual([
      { idCustomField: 'f1', value: { text: 'x' }, idValue: null },
    ]);
  });

  it('should fall back to the long url when there is no short one', () => {
    expect(
      shape.board({ id: 'b1', name: 'P', url: 'https://trello.com/b/x/p', prefs: {} })
    ).toEqual({
      id: 'b1',
      name: 'P',
      url: 'https://trello.com/b/x/p',
    });
  });

  it('should trim a board, a list, a workspace, a label and a member', () => {
    expect(
      shape.board({
        id: 'b1',
        name: 'P',
        desc: '',
        closed: false,
        idOrganization: 'w1',
        shortLink: 'Ab',
        shortUrl: 'https://trello.com/b/Ab',
        prefs: { a: 1 },
        labelNames: {},
        limits: {},
        memberships: [],
      })
    ).toEqual({
      id: 'b1',
      name: 'P',
      desc: '',
      closed: false,
      idOrganization: 'w1',
      shortLink: 'Ab',
      shortUrl: 'https://trello.com/b/Ab',
    });
    expect(
      shape.list({
        id: 'l1',
        name: 'Doing',
        closed: false,
        idBoard: 'b1',
        pos: 2,
        subscribed: false,
        softLimit: null,
      })
    ).toEqual({ id: 'l1', name: 'Doing', closed: false, idBoard: 'b1', pos: 2 });
    expect(
      shape.workspace({
        id: 'w1',
        name: 'bq',
        displayName: 'Brainquiver',
        desc: '',
        url: 'u',
        logoHash: 'h',
        prefs: {},
      })
    ).toEqual({ id: 'w1', name: 'bq', displayName: 'Brainquiver', desc: '', url: 'u' });
    expect(
      shape.label({ id: 'x1', name: 'blocked', color: 'red', idBoard: 'b1', uses: 3 })
    ).toEqual({ id: 'x1', name: 'blocked', color: 'red', idBoard: 'b1' });
    expect(
      shape.member({
        id: 'm1',
        username: 'ada',
        fullName: 'Ada L',
        avatarUrl: 'a',
        confirmed: true,
      })
    ).toEqual({ id: 'm1', username: 'ada', fullName: 'Ada L' });
  });

  it('should keep what changed in a history entry, and trim what it refers to', () => {
    expect(
      shape.action({
        id: 'ac1',
        type: 'updateCard',
        date: 'd',
        idMemberCreator: 'm1',
        memberCreator: { id: 'm1', username: 'ada', fullName: 'Ada L', avatarHash: 'h' },
        data: {
          card: { id: 'c1', name: 'A', idShort: 53, shortLink: 'Ab', idList: 'l2' },
          listBefore: { id: 'l1', name: 'To do' },
          listAfter: { id: 'l2', name: 'Doing' },
          old: { idList: 'l1' },
          board: { id: 'b1', name: 'P', shortLink: 'Xy' },
        },
        display: { translationKey: 'x', entities: {} },
        appCreator: null,
        limits: {},
      })
    ).toEqual({
      id: 'ac1',
      type: 'updateCard',
      date: 'd',
      member: { id: 'm1', username: 'ada', fullName: 'Ada L' },
      data: {
        card: { id: 'c1', name: 'A', idShort: 53 },
        listBefore: { id: 'l1', name: 'To do' },
        listAfter: { id: 'l2', name: 'Doing' },
        old: { idList: 'l1' },
        board: { id: 'b1', name: 'P' },
      },
    });
  });

  it('should keep the name, type and options of a custom field, and drop display data', () => {
    expect(
      shape.customField({
        id: 'f2',
        idModel: 'b1',
        modelType: 'board',
        fieldGroup: 'g2',
        display: { cardFront: true },
        name: 'Team',
        pos: 16384,
        type: 'list',
        options: [
          { id: 'o1', idCustomField: 'f2', value: { text: 'Core' }, color: 'none', pos: 1 },
        ],
      })
    ).toEqual({
      id: 'f2',
      name: 'Team',
      type: 'list',
      options: [{ id: 'o1', value: { text: 'Core' } }],
    });
    expect(shape.customField({ id: 'f3', name: 'Tier', type: 'list', optionsError: 'x' })).toEqual({
      id: 'f3',
      name: 'Tier',
      type: 'list',
      optionsError: 'x',
    });
  });

  it('should keep a cleared custom field value as null', () => {
    expect(
      shape.customFieldItem({
        id: 'cf1',
        idCustomField: 'f1',
        idModel: 'c1',
        modelType: 'card',
        value: null,
        idValue: null,
      })
    ).toEqual({ idCustomField: 'f1', idModel: 'c1', value: null, idValue: null });
  });

  it('should apply a shaper to each entry of an array, and leave anything else', () => {
    const lists = shape.many(shape.list);
    expect(lists([{ id: 'l1', name: 'A', softLimit: 1 }])).toEqual([{ id: 'l1', name: 'A' }]);
    expect(lists('not a list')).toBe('not a list');
  });
});

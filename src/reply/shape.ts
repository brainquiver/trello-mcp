// Trims a Trello reply to what an agent reads. Trello returns every field it has, most of
// them ids and display metadata, and each one costs the agent context on every call. The
// kept fields use Trello's own names, so an id in a reply can be passed straight back.
// A read tool takes raw: true to skip this and get the full reply.

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(value: unknown, keys: string[]): Obj {
  const out: Obj = {};
  if (!isObj(value)) return out;
  for (const key of keys) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

/** Apply a shaper to each entry of an array reply. Anything else passes unchanged. */
export function many(shaper: (value: unknown) => unknown) {
  return (value: unknown): unknown => (Array.isArray(value) ? value.map(shaper) : value);
}

export function member(value: unknown): Obj {
  return pick(value, ['id', 'username', 'fullName']);
}

export function label(value: unknown): Obj {
  return pick(value, ['id', 'name', 'color', 'idBoard']);
}

export function list(value: unknown): Obj {
  return pick(value, ['id', 'name', 'closed', 'idBoard', 'pos']);
}

export function board(value: unknown): Obj {
  const out = pick(value, ['id', 'name', 'desc', 'closed', 'idOrganization', 'shortLink']);
  return withLink(out, value);
}

export function workspace(value: unknown): Obj {
  return pick(value, ['id', 'name', 'displayName', 'desc', 'url']);
}

export function attachment(value: unknown): Obj {
  return pick(value, ['id', 'name', 'url', 'mimeType', 'bytes', 'date', 'isUpload']);
}

export function checkItem(value: unknown): Obj {
  return pick(value, ['id', 'name', 'state', 'pos', 'due', 'idMember', 'idChecklist']);
}

export function checklist(value: unknown): Obj {
  const out = pick(value, ['id', 'name', 'idCard', 'pos']);
  if (isObj(value) && Array.isArray(value.checkItems)) {
    out.checkItems = value.checkItems.map(checkItem);
  }
  return out;
}

/** A comment is an action of type commentCard. Its text and author are what matter. */
export function comment(value: unknown): Obj {
  const out = pick(value, ['id', 'date']);
  if (isObj(value)) {
    if (isObj(value.data) && value.data.text !== undefined) out.text = value.data.text;
    if (isObj(value.memberCreator)) out.member = member(value.memberCreator);
    else if (value.idMemberCreator !== undefined) out.idMember = value.idMemberCreator;
  }
  return out;
}

/** An entry in a card's or a board's history. */
export function action(value: unknown): Obj {
  const out = pick(value, ['id', 'type', 'date']);
  if (!isObj(value)) return out;
  if (isObj(value.memberCreator)) out.member = member(value.memberCreator);
  else if (value.idMemberCreator !== undefined) out.idMember = value.idMemberCreator;
  if (isObj(value.data)) {
    const data: Obj = {};
    for (const [key, entry] of Object.entries(value.data)) {
      // old holds the fields a change replaced, so it stays whole.
      if (key === 'old' || !isObj(entry)) data[key] = entry;
      else data[key] = pick(entry, ['id', 'name', 'idShort', 'state', 'text', 'url']);
    }
    out.data = data;
  }
  return out;
}

/** A custom field of a board. The options of a list field are what an agent picks from. */
export function customField(value: unknown): Obj {
  const out = pick(value, ['id', 'name', 'type', 'optionsError']);
  if (isObj(value) && Array.isArray(value.options)) {
    out.options = value.options.map(option => pick(option, ['id', 'value']));
  }
  return out;
}

/** The value of one custom field on one card. A cleared value is null, and it stays null. */
export function customFieldItem(value: unknown): Obj {
  return pick(value, ['idCustomField', 'idModel', 'value', 'idValue']);
}

export function card(value: unknown): Obj {
  if (!isObj(value)) return {};
  const out = pick(value, [
    'id',
    'idShort',
    'name',
    'desc',
    'due',
    'dueComplete',
    'start',
    'closed',
    'pos',
    'idBoard',
    'idList',
    'dateLastActivity',
  ]);
  withLink(out, value);

  if (Array.isArray(value.labels)) out.labels = value.labels.map(label);
  else if (value.idLabels !== undefined) out.idLabels = value.idLabels;
  if (Array.isArray(value.members)) out.members = value.members.map(member);
  else if (value.idMembers !== undefined) out.idMembers = value.idMembers;

  if (isObj(value.list)) out.list = pick(value.list, ['id', 'name']);
  if (isObj(value.board)) out.board = pick(value.board, ['id', 'name']);
  if (Array.isArray(value.checklists)) out.checklists = value.checklists.map(checklist);
  if (Array.isArray(value.attachments)) out.attachments = value.attachments.map(attachment);
  // get_card asks for the card's comments as actions.
  if (Array.isArray(value.actions)) out.comments = value.actions.map(comment);
  if (Array.isArray(value.customFieldItems) && value.customFieldItems.length > 0) {
    out.customFieldItems = value.customFieldItems.map(item =>
      pick(item, ['idCustomField', 'value', 'idValue'])
    );
  }
  return out;
}

// The short link is enough to open the object. The long URL only adds the slug.
function withLink(out: Obj, value: unknown): Obj {
  if (!isObj(value)) return out;
  if (value.shortUrl !== undefined) out.shortUrl = value.shortUrl;
  else if (value.url !== undefined) out.url = value.url;
  return out;
}

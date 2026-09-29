---
type: Skill
title: Trello MCP Tools
description: Every tool of the trello-mcp server, grouped by area, with its inputs and its result.
status: stable
tags: [trello-mcp, skill, trello]
generated:
  by: claude-code/opus-5.5
  at: 2026-09-23T00:56:48Z
supervised:
  by: human:ciprian-florin_ifrim
  at: 2026-09-23T00:56:48Z
part_of: ../SKILL.md
---

# Trello MCP Tools

This file lists all 52 tools of the trello-mcp server, grouped by area, with the inputs of each tool. [SKILL.md](../SKILL.md) says when to use them and what to watch, so read it first. In each table, the second column holds the required inputs and the third column holds the optional ones. The names are exact, because they come from the server itself. An input that many tools share has one explanation, in the first section below.

## 1. Shared Inputs

These inputs mean the same in every tool that takes them.

| Input | Meaning |
| --- | --- |
| **`boardId`** | The board for the call. Left out, the call uses the active board. On a tool that also names a list or a card, it is a check. The server then refuses a list or a card on another board. |
| **`cardId` or `cardNumber`** | `get_card`, `update_card_details` and `archive_card` take exactly one of the two. `cardNumber` is the number that Trello shows on the card, and it needs `boardId` or an active board. |
| **`raw`** | On a read tool, `true` returns Trello's full reply instead of the trimmed one. The default is `false`. |
| **`pos`** | A position: `top`, `bottom` or a number. |

## 2. Boards and Workspaces

These eight tools also set the active board and the active workspace.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`list_boards`** | | `raw` | The boards that the user can reach. With `TRELLO_ALLOWED_WORKSPACES` set, only the boards in those workspaces. |
| **`set_active_board`** | `boardId` | | Makes the board the active board, also for later runs. |
| **`get_active_board_info`** | | | The active board and the active workspace. |
| **`list_workspaces`** | | `raw` | The workspaces that the user can reach, or only the allowed ones. |
| **`set_active_workspace`** | `workspaceId` | | Makes the workspace the active workspace. |
| **`list_boards_in_workspace`** | `workspaceId` | `raw` | The boards in one workspace. |
| **`create_board`** | `name` | `desc`, `idOrganization`, `defaultLabels`, `defaultLists` | A new board, in the active workspace when `idOrganization` is left out. |
| **`get_recent_activity`** | | `boardId`, `limit`, `since`, `before`, `raw` | The latest actions on a board, 10 by default. |

## 3. Lists

These six tools read and change the lists of a board.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`get_lists`** | | `boardId`, `raw` | The lists of a board. |
| **`add_list_to_board`** | `name` | `boardId` | A new list on a board. |
| **`update_list`** | `listId` | `name`, `closed`, `subscribed`, `idBoard` | A renamed, archived or moved list. Give at least one optional input. |
| **`update_list_position`** | `listId`, `position` | | A list at a new place on its board. `position` is `top`, `bottom` or a number. To put a list between two others, use the average of their positions. |
| **`archive_list`** | `listId` | `boardId` | An archived list. |
| **`watch_list`** | `listId`, `subscribed` | | The user's Trello account subscribed to the list, or unsubscribed from it. |

## 4. Cards

These twelve tools find, read, make, change and archive cards.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`get_cards_by_list_id`** | `listId` | `boardId`, `fields`, `nameFilter`, `descMaxLength`, `omitDescThresholdBytes`, `raw` | The cards in a list. Each description is cut to 200 characters by default, and all of them are dropped when the reply passes 50,000 bytes. With `fields`, each card holds its ID and exactly the fields named, untrimmed. |
| **`get_my_cards`** | | `raw` | The cards that the user is a member of. |
| **`search_cards`** | `query` | `boardId`, `limit` | The cards with the words in their name or description, 20 by default and at most 100. |
| **`get_card`** | `cardId` or `cardNumber` | `boardId`, `includeMarkdown`, `raw` | One card in full, with its labels, members, checklists, attachments and comments. |
| **`get_card_history`** | `cardId` | `filter`, `limit`, `raw` | The actions on a card, all of them by default. `filter` takes an action type, as `updateCard:idList`. |
| **`add_card_to_list`** | `listId`, `name` | `boardId`, `description`, `dueDate`, `dueReminder`, `start`, `labels` | A new card. `dueReminder` is a number of minutes before the due date. |
| **`add_cards_to_list`** | `listId`, `cards` | | Up to 50 new cards, in order. Each card takes `name`, and it can take `description`, `dueDate`, `start` and `labels`. |
| **`update_card_details`** | `cardId` or `cardNumber` | `boardId`, `name`, `description`, `dueDate`, `dueReminder`, `start`, `dueComplete`, `labels`, `pos` | A changed card. `labels` replaces every label on the card. |
| **`move_card`** | `cardId`, `listId` | `boardId`, `pos` | The card in the list, on the board of that list. |
| **`copy_card`** | `sourceCardId`, `listId` | `name`, `description`, `keepFromSource`, `pos` | A copy of the card, on another board too. `keepFromSource` is `all` by default, or a list such as `checklists,labels`. |
| **`archive_card`** | `cardId` or `cardNumber` | `boardId` | An archived card. |
| **`watch_card`** | `cardId`, `subscribed` | | The user's Trello account subscribed to the card, or unsubscribed from it. |

## 5. Comments

Everyone on the board can read a comment.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`get_card_comments`** | `cardId` | `limit`, `raw` | The comments on a card, the latest 100 by default. |
| **`add_comment`** | `cardId`, `text` | | A new comment. |
| **`update_comment`** | `commentId`, `text` | | A comment with new text. |
| **`delete_comment`** | `commentId` | | A deleted comment. |

## 6. Checklists

A checklist is found by its name, on one card when `cardId` is given and otherwise on the whole board.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`create_checklist`** | `name`, `cardId` | `items` | A new checklist on a card, with its items in order. |
| **`get_checklist_items`** | `name` | `cardId`, `boardId` | The items of every checklist with that name. |
| **`get_checklist_by_name`** | `name` | `cardId`, `boardId` | One checklist, with its items and the percentage that is done. |
| **`get_acceptance_criteria`** | | `cardId`, `boardId` | The acceptance criteria. The reply has `found`. When it is true, the reply also has `items`, `unmet`, `percentComplete` and `matchedChecklistName`. When it is false, it has `reason` and `availableChecklists`. |
| **`find_checklist_items_by_description`** | `description` | `cardId`, `boardId` | The checklist items whose text contains the words. |
| **`add_checklist_item`** | `text`, `checkListName` | `cardId`, `boardId` | A new item on the checklist with that name. |
| **`update_checklist_item`** | `cardId`, `checkItemId` | `state`, `name`, `pos`, `due`, `dueReminder`, `idMember` | A changed item. `state` is `complete` or `incomplete`. Give at least one optional input. |
| **`delete_checklist_item`** | `cardId`, `checkItemId` | | A deleted item. |
| **`copy_checklist`** | `sourceChecklistId`, `cardId` | `name`, `pos` | A copy of the checklist and its items on a card, on another board too. |

## 7. Attachments

Section 5.5 of [SKILL.md](../SKILL.md) gives the rules for `source`.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`attach_to_card`** | `cardId`, `source` | `name`, `mimeType` | A link, a local file or inline data, attached to the card. |
| **`download_attachment`** | `cardId`, `attachmentId` | | An uploaded file: an image as an image, and any other file as base64. The server refuses a link and a file over the download limit. |

## 8. Labels

A label belongs to a board, and a card carries the labels of its own board.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`get_board_labels`** | | `boardId`, `raw` | The labels of a board, with their IDs. |
| **`create_label`** | `name` | `boardId`, `color` | A new label. `color` is `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `sky`, `lime`, `black`, or `null` to remove the colour. |
| **`update_label`** | `labelId` | `name`, `color` | A renamed or recoloured label. |
| **`delete_label`** | `labelId` | | A deleted label, removed from every card that carried it. |
| **`add_label_to_card`** | `cardId`, `labelId` | | The card with one more label. The other labels stay. |
| **`remove_label_from_card`** | `cardId`, `labelId` | | The card with that label removed. The other labels stay. |

## 9. Members

A member is a person with access to the board.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`get_board_members`** | | `boardId`, `raw` | The members of a board, with their IDs. |
| **`assign_member_to_card`** | `cardId`, `memberId` | | The members on the card, the new member included. |
| **`remove_member_from_card`** | `cardId`, `memberId` | | The members that stay on the card. |

## 10. Custom Fields

These two tools need a paid Trello plan, and Trello refuses them on the free plan.

| Tool | Required | Optional | Result |
| --- | --- | --- | --- |
| **`get_board_custom_fields`** | | `boardId` | The custom fields of a board, with the options of each list field. |
| **`update_card_custom_field`** | `cardId`, `customFieldId`, `type` | `value` | A custom field value set or cleared on a card. `type` is `text`, `number`, `checkbox`, `date`, `list` or `clear`. Every type except `clear` needs `value`, and for `list`, `value` is the ID of the option. |

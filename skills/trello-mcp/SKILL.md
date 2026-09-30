---
name: trello-mcp
description: Reads and changes Trello boards, lists, cards, checklists, comments, labels and attachments through the tools of the trello-mcp server. Use it when a task names a Trello board, list or card, gives a card number such as the 53 in fix/53-chat-button, or asks for the acceptance criteria of a card.
---

# Trello MCP

This skill tells an agent how to use Trello through the trello-mcp server. The server gives the agent 52 Model Context Protocol (MCP) tools, which read and change Trello boards, lists, cards and what they hold. Every tool name and every input in this file is exact. The full list, with each input of each tool, is in [references/tools.md](references/tools.md). When a call would go wrong, the server refuses it and gives the reason. Read that reason before you call again, because it usually says what to change.

## 1. Server Status

When a tool is absent or a call times out, the server is either stopped or disconnected. Do not install, start or configure the server yourself. Its configuration holds the user's Trello credentials, so only the user changes it. Stop the task. Then tell the user what you saw. Section 1.4 of [README.md](../../README.md), Server Checks, lists the steps that find the fault.

## 2. Names for Boards, Lists and Cards

Trello names each board, list, card, checklist, label and member with an identifier (ID). An ID is a code of letters and digits that only Trello can give. Never make an ID from a name or from a web address (URL). Copy each ID exactly from a tool's reply. Three inputs let a call use less than a full ID, and each one has a rule.

| Input | Rule |
| --- | --- |
| **`boardId` left out** | The call uses the active board. That is the last board that `set_active_board` chose, and the server keeps it between runs. Before the first choice, it is the board in `TRELLO_BOARD_ID`. |
| **`cardNumber`** | The number that Trello shows on a card, and the number that a branch name carries, as 53 in `fix/53-chat-button`. `get_card`, `update_card_details` and `archive_card` take it in place of `cardId`. It needs `boardId` or an active board. Trello gives a card a new number on each board that it moves to. |
| **`boardId` with a list or a card** | A check. When the list or the card is on another board, the server refuses the call before it changes anything. A board matches by its ID or by the short link in its URL. |

## 3. Card Discovery

Use the first row that matches what you know.

| What you know | Call |
| --- | --- |
| **The card number** | `get_card` with `cardNumber` |
| **Words from the card** | `search_cards` with `query`. A word matches as a prefix. Trello adds a new card to its search index after a few minutes. |
| **The list** | `get_cards_by_list_id`, with `nameFilter` for part of the card name |
| **The board only** | `get_lists`, then `get_cards_by_list_id` on the likely lists |
| **Only the task** | `list_boards`, then ask the user which board to use |
| **The user's own cards** | `get_my_cards` |

`get_cards_by_list_id` cuts each description to 200 characters, and it drops the descriptions when the reply passes 50,000 bytes. Use `get_card` for the full card.

## 4. Card Rules

A card follows these rules. The server itself refuses a description over the limit, and the other rules are for the agent to keep.

| Rule | Detail |
| --- | --- |
| **Description length** | At most 2400 characters by default, or the number in `TRELLO_DESCRIPTION_LIMIT`. The tool descriptions show the limit in force. A longer description is refused before anything goes to Trello. |
| **Acceptance criteria** | The conditions that say when a card is done. They go in a checklist named `Acceptance Criteria`. `get_acceptance_criteria` also finds a checklist named `AC`, `DoD` or `Definition of Done`. |
| **Labels** | `labels` in `update_card_details` replaces every label on the card. To add or remove one label, use `add_label_to_card` or `remove_label_from_card`. |
| **Blocked card** | Add the `blocked` label. Then add a comment with the number of the card that blocks it. When the board lacks a `blocked` label, ask the user before you make one. |
| **Dates** | `dueDate`, and `due` on a checklist item, take an ISO 8601 timestamp, as `2026-10-01T12:00:00Z`. `start` takes a date alone, as `2026-10-01`. |

## 5. Common Workflows

### 5.1 Card Change

1. Run `get_card` to read the card as it is now.
2. Run the narrowest tool for the change, as `update_card_details` or `move_card`.
3. Run `get_card` again to confirm the result.

`move_card` puts the card on the board of the list that you give, so a move to another board takes the same inputs. After a move to another board, the card has a new number. Read it from the reply.

### 5.2 New Card with Acceptance Criteria

1. Run `get_lists` to find the ID of the target list.
2. Run `add_card_to_list`.
3. Run `create_checklist` with the name `Acceptance Criteria` and the criteria in `items`.
4. Run `get_acceptance_criteria` to confirm that the server finds them.

### 5.3 Work to Acceptance Criteria

1. Run `get_acceptance_criteria` for the card.
2. If `found` is true, do the work in `items`. `unmet` holds only the items that are still open.
3. If `found` is false, read `reason` and `availableChecklists`. The criteria can be in a checklist with another name.
4. When you have verified the work for an item, run `update_checklist_item` with `state` set to `complete`.

### 5.4 Several Cards at Once

`add_cards_to_list` makes up to 50 cards in order. The server checks every card before it makes the first one, so bad input leaves the board unchanged. It retries a temporary Trello or network fault by itself.

1. Run `add_cards_to_list`.
2. When the reply is an error, read its first sentence. It lists the cards made so far and the cards that remain.
3. Tell the user. Then wait for an answer before you send the rest of the cards.

Warning: when the reply says that a card may have been made, look at the list before you send that card again.

### 5.5 File Attachment

`attach_to_card` takes one `source`, and its prefix decides the result.

| `source` starts with | Result |
| --- | --- |
| **`https://`** | Trello keeps a link. The file stays at that address, and the attachment breaks if the file moves. |
| **`file://`** | The server uploads a local file. The file must be inside the folder in `TRELLO_ATTACH_ROOT`. Without that setting, every local upload is refused. |
| **`data:<mime>;base64,<data>`** | The server uploads the data. |

A `name` without an extension takes the source's extension. For example, `test-56-chat-button` on a file that ends in `.png` becomes `test-56-chat-button.png`. The server refuses an `http://` address and an address on a private network.

### 5.6 Status Note

Warning: everyone on the board can read a comment.

1. Run `add_comment` with a short note.
2. Run `get_card_comments` to confirm it.

## 6. Replies

Each reply is compact JavaScript Object Notation (JSON) that holds the fields an agent reads, under the names that Trello uses. An ID in a reply is therefore ready for the next call. Thirteen read tools take `raw: true`, and then they return Trello's full reply. The tables in [references/tools.md](references/tools.md) show which ones. `get_card` with `includeMarkdown: true` returns the card as readable markdown, and markdown wins when both are set. `download_attachment` returns an image as an image and any other file as base64 text. It returns only a file that was uploaded to Trello, up to 5 megabytes (MB) by default or the number in `TRELLO_MAX_DOWNLOAD_MB`.

## 7. Traps

Each row gives the condition first and the action after it, as a warning does.

| When | Action |
| --- | --- |
| **A call archives, deletes or removes** | Run `archive_card`, `archive_list`, `delete_comment`, `delete_checklist_item`, `delete_label`, `remove_label_from_card` or `remove_member_from_card` only when the user clearly asked for it. |
| **A reply says "Refused by the workspace guard"** | Stop. The object is outside the workspaces that the user allows. Tell the user. Do not try another way to reach it. |
| **A `file://` source is refused** | Use an `https://` link or a `data:` source. Or ask the user to set `TRELLO_ATTACH_ROOT`. |
| **The user asks to watch a card or a list** | `watch_card` and `watch_list` subscribe the user's Trello account, so the notifications go to the user alone. |
| **`get_board_custom_fields` returns an empty list** | The board has no custom fields. No tool creates one, so ask the user to add the field in Trello. |
| **A write fails** | Read the object again before you retry. It may have moved, or somebody may have archived it. |
| **Many calls go out in a short time** | Trello allows 100 calls in 10 seconds for each token. The server queues the calls and retries a refusal. Read a board once. Then reuse what it returned. |

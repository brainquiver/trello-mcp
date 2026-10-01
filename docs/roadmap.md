---
type: Roadmap
title: Trello MCP Roadmap
description: What the Trello MCP server will gain from October 2026 to October 2027, and the work that stays outside the project.
status: stable
tags: [roadmap, trello-mcp]
generated:
  by: claude-code/opus-5.5
  at: 2026-10-01T10:53:39Z
supervised:
  by: human:ciprian-florin_ifrim
  at: 2026-10-01T10:53:39Z
---

# Trello MCP Roadmap

This roadmap covers October 2026 to October 2027.

## 1. Tagged Releases

Each release will carry a Semantic Versioning tag, such as `v1.1.0`, and a GitHub release with notes. The notes will name the changes since the previous release and each vulnerability that the release fixes. Today every user runs the latest commit on `main`, because the repository does not publish releases. A tag lets a user pin a build that is known to work, and the security policy will then name the supported releases.

## 2. Agent Safety

Each tool will declare whether it reads, writes or deletes, through the tool hints of the Model Context Protocol (MCP). An MCP client can then ask the user before a write. A read-only setting will refuse every write, whatever the token allows. A tool allow-list will register only the tools that the user names, so the agent sees only those tools. The read-only setting and the allow-list hold whatever a card asks the agent to do, because the server applies them before a call reaches Trello.

## 3. New Trello Features

The server will gain a tool for each new Trello feature that a board workflow needs. Trello adds features to its API, and an agent can use a feature only through a tool of this server. Each new tool follows [section 4 of the README](../README.md#4-rules), from its trimmed reply to its route in the workspace guard.

## 4. Agent Skill

The agent skill in `skills/trello-mcp/` will change with the safety measures and with each new tool. For the safety measures, it will say when the agent must ask the user before a write. It will also say what a refusal from the read-only setting or the allow-list means. For each new tool, it will gain a row in the tool list and the workflow that the tool serves. An agent then learns each limit from the skill before it meets the limit in a refusal.

## 5. Excluded Work

Two kinds of work stay outside the project this year.

| Exclusion | Reason |
| --- | --- |
| **Deletion of cards, lists and boards** | Trello cannot undo a deletion, but an archived card or list can be restored. |
| **More than one Trello account for each server** | The key and the token authenticate one account, and a second account needs a second client entry. |

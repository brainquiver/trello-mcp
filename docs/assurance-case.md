---
type: Assurance Case
title: Trello MCP Assurance Case
description: The threats to the Trello MCP server, its trust boundaries, and the design and code that answer each threat.
status: stable
tags: [security, assurance, trello-mcp]
generated:
  by: claude-code/opus-5.5
  at: 2026-10-01T11:32:44Z
supervised:
  by: human:ciprian-florin_ifrim
  at: 2026-10-01T11:32:44Z
---

# Trello MCP Assurance Case

This assurance case argues that the Trello MCP server meets the expectations in [section 2 of its security policy](../.github/SECURITY.md#2-security-expectations).

## 1. Threat Model

The threats come from the text on a board, from the agent that reads it, and from the code that the server depends on.

| Threat | Source | Harm |
| --- | --- | --- |
| **Prompt injection** | Card text, which any board member can write | The agent obeys the text and changes or copies board data |
| **Local file exfiltration** | A prompt injection that asks for a file such as `.env` | The file becomes an attachment that every board member can read |
| **Access outside the allowed workspaces** | A call that names a board, a list or a card in another workspace | The agent reads or changes a board that the user did not allow |
| **Request to a private network** | An attachment link to a local or private address | A service on that network receives a request |
| **Token disclosure** | An error reply, a saved file or a log | Anybody who reads the token can act as the user in Trello |
| **Resource exhaustion** | A large download, a large batch or a request that hangs | The agent's context fills, or a call never returns |
| **Repeated writes** | A write sent again after a lost reply | A card appears twice on the board |
| **Supply-chain compromise** | A dependency or a GitHub Action with hostile code | The code runs with the user's token, or in continuous integration (CI) with its secrets |

## 2. Trust Boundaries

Five boundaries separate what the server trusts from what it checks.

| Boundary | Data | Treatment |
| --- | --- | --- |
| **Agent to server, over standard input and output** | Tool calls from an agent that may be misled | Each input is validated, and each request passes the guards |
| **Server to Trello, over HTTPS** | Requests with the key and the token, and Trello's replies | Node.js verifies the certificate, and card text reaches the agent as data |
| **Server to the local file system** | Files for upload, and the saved active board | A file must sit inside `TRELLO_ATTACH_ROOT`, and `~/.trello-mcp/config.json` holds the IDs of the active board and its workspace |
| **Environment to server** | The key, the token and the settings | The user's Model Context Protocol (MCP) client sets them, so the server trusts them |
| **Fork to CI** | Pull requests from anybody | The tests run without secrets, and the smoke secrets reach only the `main` branch |

## 3. Secure Design Principles

The design applies six of Saltzer and Schroeder's secure design principles.

| Principle | Application | File |
| --- | --- | --- |
| **Least privilege** | The workspace guard limits the agent to the allowed workspaces, and the attach root limits uploads to one folder | `src/trello/workspace-guard.ts`, `src/trello/attachments.ts` |
| **Fail-safe defaults** | Local uploads are off until `TRELLO_ATTACH_ROOT` is set, and the guard refuses a route that it cannot trace to a workspace | `src/trello/attachments.ts`, `src/trello/workspace-guard.ts` |
| **Complete mediation** | When `TRELLO_ALLOWED_WORKSPACES` is set, the guard runs as a request interceptor on the server's HTTP client, so every request passes it | `src/trello/client.ts` |
| **Economy of mechanism** | One HTTP client carries every request, and its interceptors hold the rate limit, the guard and the retry rule | `src/trello/client.ts` |
| **Open design** | The source is public, and every secret comes from the environment | `src/index.ts` |
| **Psychological acceptability** | Every refusal reaches the agent with its reason, so the agent can tell the user what to change | `src/trello/client.ts` |

## 4. Common Weaknesses

Each weakness with an entry in the Common Weakness Enumeration (CWE) carries its number.

| Weakness | Defense | File |
| --- | --- | --- |
| **Path traversal, CWE-22** | The attach folder check resolves the real paths of the root and the file, then refuses a file whose path leaves the root. A symbolic link resolves first, so it cannot escape the root | `src/trello/attachments.ts` |
| **Server-side request forgery, CWE-918** | Trello stores an attachment link, and the server never fetches it. As a second defense, the link must use `https://`, and the URL check refuses `localhost` and private addresses | `src/trello/url-validator.ts` |
| **Improper input validation, CWE-20** | Each of the 52 tools checks its inputs with a zod schema before its handler runs, and the client checks dates and description lengths | `src/tools/`, `src/trello/validation.ts` |
| **Exposure of sensitive information, CWE-200** | An error reply carries only Trello's status code and message, so the token in the request never reaches the agent | `src/trello/errors.ts` |
| **Uncontrolled resource consumption, CWE-400** | Each request stops after 30 seconds, a batch takes at most 50 cards, a download stops at 5 MB by default, and a rate limiter paces the calls | `src/trello/client.ts`, `src/trello/batch.ts` |
| **Command and code injection, CWE-78 and CWE-94** | The server does not start a process, and it does not evaluate text as code | `src/` |
| **Repeated writes** | The client repeats a write only after a 429, because Trello sends a 429 before it acts. After a lost reply, a batch searches the list for the card before it sends the card again | `src/trello/client.ts`, `src/trello/batch.ts` |
| **Untrusted dependencies, CWE-829** | `package-lock.json` pins each package with an integrity hash, each action is pinned to a commit hash, and Dependabot proposes each update as a pull request | `package-lock.json`, `.github/` |

## 5. Residual Risks

Six risks remain, and [section 2 of the roadmap](roadmap.md#2-agent-safety) narrows the first and the third.

| Risk | Reason |
| --- | --- |
| **Writes inside the guards** | A misled agent can change any card that the guards allow, because the server does not judge the intent of a call |
| **Optional workspace guard** | Without `TRELLO_ALLOWED_WORKSPACES`, the agent reaches every board that the token reaches |
| **Tools that delete** | `delete_comment`, `delete_checklist_item` and `delete_label` remove data that Trello cannot restore |
| **Hostnames in attachment links** | The URL check tests the address as written, so a hostname that resolves to a private address passes. Any fetch of the link comes from Trello's network, because the server sends only the address |
| **Token in the query string** | Trello takes the key and the token as query parameters, so a proxy that decrypts Transport Layer Security (TLS) can read them |
| **Compromised dependency** | A hostile release in the lockfile runs with the user's token. The lockfile and Dependabot limit that risk to a release that a person merged |

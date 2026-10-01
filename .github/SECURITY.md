---
type: Security Policy
title: Trello MCP Security Policy
description: What the Trello MCP server protects, where to report a vulnerability, how a report is handled, and what the policy covers.
status: stable
tags: [security, trello-mcp]
generated:
  by: claude-code/opus-5.5
  at: 2026-09-30T22:11:56Z
supervised:
  by: human:ciprian-florin_ifrim
  at: 2026-09-30T22:11:56Z
edited:
  by: claude-code/opus-5.5
  at: 2026-10-01T10:03:57Z
---

# Trello MCP Security Policy

Trello MCP runs on each user's machine and calls the Trello API with that user's key and token. A vulnerability in the server can therefore expose a Trello account, a local file, or a workspace that the workspace guard exists to protect. Every secret that the server uses comes from the environment of the MCP client that starts it.

## 1. Supported Version

The repository does not publish releases, so the `main` branch is the only supported version. A user gets a fix with `git pull` and `npm run build`, and the MCP client runs the new build after its next restart. A report against an older commit is still welcome, because the fault may still exist on `main`.

## 2. Security Expectations

The server connects to one host, `https://api.trello.com`, and Node.js verifies its certificate on every request. The user's key and token are read from the environment and kept in memory. The server writes one file, `~/.trello-mcp/config.json`, which holds the IDs of the active board and its workspace. Attachment links must use `https://` and a public address. A secret therefore leaves the machine only over a verified connection to Trello.

Two settings narrow what an agent can reach. When `TRELLO_ALLOWED_WORKSPACES` is set, the workspace guard refuses any request outside those workspaces, personal boards included. Without it, the agent reaches every board that the token reaches. `TRELLO_ATTACH_ROOT` names the folder for local uploads, and each file's real path must stay inside it. Without it, the server refuses every local upload.

The server trusts its agent. It does not judge the intent of a call, so only the guards limit an attack. Card text can carry a prompt injection, an instruction planted for an agent to obey, and the server returns that text unchanged. An agent that obeys it can change any card that the guards allow. The token sets the outer limit, so a read-only token makes the server read-only.

## 3. Vulnerability Reports

A vulnerability report goes privately to the maintainer, through the [Report a vulnerability](https://github.com/brainquiver/trello-mcp/security/advisories/new) form in the Security tab of this repository. A public issue or pull request would show the fault to everyone before a fix exists, so a vulnerability goes through the private form alone. A useful report names the commit, the tool and the input that trigger the fault, and it says what an attacker could gain. Made-up keys, tokens and boards are enough to show a fault, so a report never needs real credentials.

## 4. Report Response

The maintainer answers each report in its advisory, which stays private until it is published. The maintainer first confirms the fault on `main` and agrees its severity with the reporter. The fix is prepared in the advisory's temporary private fork, and it reaches `main` before the advisory is published. The published advisory names the affected commits and the fix, with a Common Vulnerabilities and Exposures (CVE) identifier when the fault warrants one. It credits the reporter by GitHub account or by name, unless the reporter asks to stay anonymous. When the maintainer cannot confirm a fault, the advisory is closed with the reason in its thread.

## 5. Scope

The policy covers the code in this repository: the server in `src/`, its workspace guard and attachment checks, the workflows in `.github/`, and the agent skill in `skills/`. A fault in a dependency is in scope when it affects this server, and the report then names the dependency and its version. The Trello API and the hosted Trello MCP server belong to Atlassian, so a fault in either one goes to Atlassian. A leaked Trello token is a matter for its owner, who revokes it in the Trello account settings.

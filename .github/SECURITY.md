---
type: Security Policy
title: Trello MCP Security Policy
description: Where to report a vulnerability in the Trello MCP server, what a report includes, and what the policy covers.
status: stable
tags: [security, trello-mcp]
generated:
  by: claude-code/opus-5.5
  at: 2026-09-30T22:11:56Z
supervised:
  by: human:ciprian-florin_ifrim
  at: 2026-09-30T22:11:56Z
---

# Trello MCP Security Policy

Trello MCP runs on each user's machine and calls the Trello API with that user's key and token. A vulnerability in the server can therefore expose a Trello account, a local file, or a workspace that the workspace guard exists to protect. Every secret that the server uses comes from the environment of the MCP client that starts it.

## 1. Supported Version

The repository does not publish releases, so the `main` branch is the only supported version. A user gets a fix with `git pull` and `npm run build`, and the MCP client runs the new build after its next restart. A report against an older commit is still welcome, because the fault may still exist on `main`.

## 2. Vulnerability Reports

A vulnerability report goes privately to the maintainer, through the [Report a vulnerability](https://github.com/brainquiver/trello-mcp/security/advisories/new) form in the Security tab of this repository. A public issue or pull request would show the fault to everyone before a fix exists, so a vulnerability goes through the private form alone. A useful report names the commit, the tool and the input that trigger the fault, and it says what an attacker could gain. Made-up keys, tokens and boards are enough to show a fault, so a report never needs real credentials.

## 3. Scope

The policy covers the code in this repository: the server in `src/`, its workspace guard and attachment checks, the workflows in `.github/`, and the agent skill in `skills/`. A fault in a dependency is in scope when it affects this server, and the report then names the dependency and its version. The Trello API and the hosted Trello MCP server belong to Atlassian, so a fault in either one goes to Atlassian. A leaked Trello token is a matter for its owner, who revokes it in the Trello account settings.

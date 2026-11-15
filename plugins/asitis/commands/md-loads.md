---
description: Show what each agent (Claude Code, Codex, Gemini CLI, Cursor, Copilot) actually loads when a session starts in a folder, what loads later, what gets cut and what is never read
argument-hint: [folder] [tool]
allowed-tools: mcp__plugin_asitis_asitis__load_plan
---
Call the `load_plan` tool from the `asitis` MCP server.

- If `$ARGUMENTS` names a folder, pass it as `cwd`. If it also names one of claude-code, codex, gemini-cli, cursor or copilot, pass that as `tool`.
- With no arguments, call it with no arguments (the project root, all five tools).
- If the result says to call again with an offset, do that only when the user asks for the rest.

Report the result to the user in this order, and keep it short:

1. One line per tool: what loads at launch and its token total, largest first.
2. Anything cut or not loaded that the user probably expects to load (for example an AGENTS.md that Claude Code skips because of a CLAUDE.md, a nested AGENTS.md past Codex's 32 KiB, a subfolder CLAUDE.md over 40,000 characters, skills in `.agents/skills`, an import that waits for approval because it sits outside the start folder), with the reason the tool gave.
3. What loads later and when, in one or two lines, if it matters for the folder the user asked about.
4. Steps marked (assumed): say these are not confirmed yet.

Quote file names and reasons as the tool printed them. Say once that the numbers are local estimates. Do not edit any file unless the user asks.

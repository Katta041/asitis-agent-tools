---
name: md-loads
description: Show what Cursor, Claude Code, Codex, Gemini CLI and Copilot actually load when a session starts in a folder, and what they skip
---
Call the `load_plan` tool from the `asitis` MCP server.

If the user named a folder, pass it as `cwd`. If they named one of cursor, claude-code, codex, gemini-cli or copilot, pass that as `tool`. With nothing named, call it with no arguments.

Report in this order, and keep it short:

1. One line per tool: what loads at launch and its token total, largest first.
2. Anything cut or not loaded that the user probably expects to load, with the reason the tool gave.
3. What loads later and when, in one or two lines, if it matters for that folder.
4. Steps marked (assumed): say these are not confirmed yet.

Quote file names and reasons as the tool printed them. Say once that the numbers are local estimates. Do not edit any file unless the user asks.

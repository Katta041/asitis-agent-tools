---
name: md-budget
description: Show approximately how many tokens your steering files load every session, per tool (Cursor, Claude Code, Codex, Gemini CLI, Copilot)
---
Call the `context_budget` tool from the `asitis` MCP server with no arguments.

Report one line per tool with its approximate total, largest first, then the three biggest files with their token counts. Say once that the numbers are local estimates (about 4 characters per token). If a tool's total is over 2,000 tokens, name the file that would save the most if it were shortened or moved to a rule that only applies to matching files.

Do not edit any file unless the user asks.

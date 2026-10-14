---
description: Show approximately how many tokens your steering files load every session, per tool (Claude Code, Codex, Gemini CLI, Cursor, Copilot)
argument-hint: [path]
allowed-tools: mcp__plugin_asitis_asitis__context_budget
---
Call the `context_budget` tool from the `asitis` MCP server.

- With a path (`$ARGUMENTS`), call it with `path` set to that path to see that file and its `@imports`.
- With no path, call it with no arguments for the whole project.

Report the result to the user in this order, and keep it short:

1. One line per tool with its every-session total, largest first, for example `Claude Code: about 3.9k tokens`. The tool output already lists them in that order.
2. The three biggest contributors, and any warnings the tool printed (for example CLAUDE.md over 200 lines, AGENTS.md over the 32 KiB Codex limit, a missing `@import`).
3. At most three concrete ways to cut context, such as moving path-specific rules into `.claude/rules/` with `paths` frontmatter, or moving detail out of SKILL.md into referenced files.

Say once that the numbers are local estimates. If nothing loads every session, say that in one line and stop. Do not edit any file unless the user asks.

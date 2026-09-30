---
description: Show approximately how many tokens your steering files load every session, per tool (Claude Code, Codex, Gemini CLI, Cursor, Copilot)
argument-hint: [path]
allowed-tools: mcp__plugin_asitis_asitis__context_budget
---
Use the `context_budget` tool from the `asitis` MCP server.

- If a path was given (`$ARGUMENTS`), call `context_budget` with `path` set to it to see that file and its `@imports`.
- Otherwise call `context_budget` with no arguments for the whole project.

Report to the user:

1. The every-session total per tool, largest first.
2. The three biggest contributors and any warnings (for example CLAUDE.md over 200 lines, AGENTS.md over the 32 KiB Codex limit, a missing `@import`).
3. At most three concrete suggestions to cut context, such as moving path-specific rules into `.claude/rules/` with `paths` frontmatter or moving detail out of SKILL.md into referenced files.

Say that the numbers are local approximations. Do not edit any file unless the user asks.

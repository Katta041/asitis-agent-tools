# asitis-agent-tools

A read-only linter for agent steering files (CLAUDE.md, AGENTS.md, SKILL.md, Cursor rules, Copilot instructions, GEMINI.md and others). It ships as an MCP server (`@asitis/mcp`, in `packages/mcp`) and a Claude Code plugin (`plugins/asitis`).

Read CONTRIBUTING.md first. Its rules are enforced by tests. In short: no write, exec or network code; scanners stay linear; bump all version files together; never edit fixtures in an editor; no em-dashes or emoji.

## Commands

- `npm ci && npm test` at the root runs the full suite (typecheck, build and tests).
- `npm run sync-plugin` must run from `packages/mcp`, not the root. Run it after any change to `packages/mcp/src` and commit `plugins/asitis/server/`.

## Things that have bitten us

- **Tool results are text only by default.** Claude Code 2.1 shows the model a result's `structuredContent` instead of its text when both are present. A script or test that needs the JSON must start the server with `--structured`.
- **Unit tests are not enough.** Before a release, run the plugin in real Claude Code from a scratch copy of a project: `claude -p "/asitis:md-lint" --plugin-dir plugins/asitis`. Ask the model to quote what the tool returned.
- **Check vendor docs before changing a rule.** Each rule cites the vendor doc it rests on and the date it was read. Vendor docs change, so recheck them first.
- **What Claude Code actually loads:**
  - AGENTS.md is read only when there is no CLAUDE.md, `.claude/CLAUDE.md` or CLAUDE.local.md, or through an `@AGENTS.md` import.
  - Codex's 32 KiB is one budget shared by every AGENTS.md from the root down.
- **Windows:** CI runs on Windows. Use native realpath, and expect 8.3 short paths in temp folders.
- **Results must stay small.** Claude Code rejects large tool results, so cap and page anything that grows with repo size.
- **Error messages:** errors never show an absolute path or a stack trace.

## Writing

Commit messages, docs and release notes should read like the person who did the work wrote them: plain, specific and short. Commits are by `AsItIs <dev@asitis.app>`, with no AI attribution lines.

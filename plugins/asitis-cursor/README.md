# AsItIs for Cursor (plugin, untested in Cursor)

This folder is a Cursor plugin: the AsItIs MCP server pinned to `@asitis/mcp@0.4.7`, a rule that asks the agent to run `lint_steering` after it edits an AGENTS.md, a Cursor rule or a CLAUDE.md, the `/md-lint`, `/md-loads` and `/md-budget` commands, and the byte-clean editing skill.

I haven't run it inside Cursor yet. The manifest, the marketplace entry and the files are checked by the repo's tests, and the server itself is the same one the README's Cursor config starts. What I can't confirm without Cursor:

- Whether Cursor expands `${workspaceFolder}` in a plugin's `mcp.json`. Cursor documents it for a project's `.cursor/mcp.json`, not for plugins. If it isn't expanded, the server gets a literal `${workspaceFolder}` as its root and exits with "Root folder not found".
- Whether the rule attaches only when a steering file is in context, as its `globs` say.

The server is started with `npx --prefix=~/`, so npx looks for an installed copy in your home folder and never runs a `node_modules/@asitis/mcp` that the open project commits. Running the bundled server under Node's permission model, as the Claude Code plugin does, would need the bundle copied into this folder; that waits until the plugin is tested in Cursor.

If you just want the tools in Cursor today, use the [Add to Cursor](../../README.md#other-mcp-clients-claude-desktop-cursor-codex-gemini-cli) link or the `.cursor/mcp.json` config in the README. Those are the documented paths. If you try the plugin, an issue saying whether it worked would help a lot.

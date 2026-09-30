# AsItIs for Claude Code

**Keep markdown and agent steering files byte-clean.** From [AsItIs](https://asitis.app/?ref=claude-plugin), the markdown editor that never rewrites your file. Nothing changes unless you change it.

| Part | What it does |
|---|---|
| MCP server `asitis` | Five read-only tools: `read_markdown`, `outline`, `lint_steering`, `context_budget`, `find_steering_files`. See [`@asitis/mcp`](../../packages/mcp/README.md). |
| Skill `markdown-byte-clean` | Teaches Claude to edit minimal ranges, never rewrite whole markdown files, and keep frontmatter, line endings, BOM and trailing spaces exactly as they are. |
| `/asitis:md-lint [path]` | Lints steering files: frontmatter on line 1, YAML, required fields, limits, broken links and `@imports`, invisible characters, hidden instructions. |
| `/asitis:md-budget [path]` | Shows approximately how many tokens load every session, per tool, and what to cut. |
| Guard hook (optional) | Warns before a Write, Edit or MultiEdit that would change line endings, strip trailing spaces, drop a BOM or break frontmatter in an existing markdown file. |

## Install

Requires Claude Code and Node 22.13 or later on your `PATH` (the server and hook run with `node`).

```bash
claude plugin marketplace add Katta041/asitis-agent-tools
claude plugin install asitis@asitis
```

From a local clone of [the repository](https://github.com/Katta041/asitis-agent-tools), pass the clone's folder instead: `claude plugin marketplace add ./asitis-agent-tools`. To try it for one session without installing, run `claude --plugin-dir ./asitis-agent-tools/plugins/asitis`.

Inside a session, `/plugin marketplace add Katta041/asitis-agent-tools` and `/plugin install asitis@asitis` do the same. Remove it with `claude plugin marketplace remove asitis`.

For other assistants (Claude Desktop, Cursor, Codex, Gemini CLI), use the MCP server on its own; config snippets are in the [repository README](../../README.md#other-mcp-clients-claude-desktop-cursor-codex-gemini-cli).

## Privacy

- No network. The server and the hook make no connections, collect nothing and send nothing.
- No writes. The server has no write tool and no write code; the hook only reads the file it is asked about.
- The server runs under Node's permission model: `node --permission` with read access to this plugin and your project folder only, and no write, network or child-process rights. Node enforces that, not just our code.
- Tool results go into Claude's context and so reach Anthropic like the rest of your session. That is Claude Code's traffic, not ours.

## Pinned server

The server is not fetched from npm at runtime. `server/asitis-mcp.mjs` is the exact `@asitis/mcp` build for this plugin version (one file, zero dependencies), and `server/VERSION` records its version and SHA-256. A test fails if the file differs from a fresh build or if the versions disagree. `server/THIRD_PARTY_NOTICES.md` lists the bundled open-source licences.

## The guard hook is an accident guard, not a security boundary

It exists to catch the common accident: an agent rewrites a whole file with `Write`, or an `Edit` whose `new_string` quietly drops trailing spaces or CRLF line endings. It checks `Write`, `Edit` and `MultiEdit` on existing `.md`, `.mdc`, `.markdown`, `.mdx`, `.cursorrules`, `.windsurfrules` and `.clinerules` files and warns when the change would:

- convert CRLF to LF (or the reverse), flatten mixed line endings or remove lone CRs;
- strip trailing whitespace (two trailing spaces are a hard line break);
- remove or add the BOM, or drop the final newline;
- move the frontmatter off line 1, remove its closing `---`, drop keys or indent it with tabs;
- rewrite more than 30% of an existing file of more than 20 lines;
- touch a file with invalid UTF-8 bytes, which a text tool will replace.

What it does not do: it does not see `Bash` (`sed -i`, redirects, scripts), `NotebookEdit`, other tools or other programs, and anything running as you can bypass it. When an `Edit`'s LF `old_string` matches only CRLF text, it assumes Claude Code maps the replacement onto CRLF. It never changes the tool call.

Modes, set with the plugin option **guard_mode** (`/config`, or `CLAUDE_PLUGIN_OPTION_GUARD_MODE`, or `ASITIS_GUARD_MODE`):

| Mode | Behaviour |
|---|---|
| `ask` (default) | Shows the warning and asks you to allow or reject the change. |
| `deny` | Blocks the change and tells Claude to retry with a minimal edit. |
| `off` | Disabled. |

It fails closed: if the hook input is not valid JSON or lacks the fields it needs, the change is blocked with a one-line message saying why (`AsItIs guard: the hook input is not valid JSON. The change was blocked to be safe; ...`). Set `guard_mode` to `off` if that ever gets in your way.

## Options

| Option | Default | Effect |
|---|---|---|
| `guard_mode` | `ask` | `ask`, `deny` or `off` for the guard hook. |
| `footer` | `true` | Each tool result ends with one line linking to asitis.app. Set to `false` to hide it. |

## Develop

From the repository root:

```bash
npm ci
npm test               # includes the hook, plugin and protocol tests
npm run sync-plugin    # rebuild the server and copy it into server/
claude plugin validate . --strict
claude plugin validate ./plugins/asitis --strict
```

## License

MIT. See [LICENSE](LICENSE).

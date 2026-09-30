# AsItIs agent tools

**Read-only tools for markdown and AI agent steering files.** An MCP server and a Claude Code plugin that read, outline, lint and budget `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `SKILL.md`, subagents, commands, rules, Cursor `.mdc` rules, Copilot instructions and memory files, without being able to change any of them.

From [AsItIs](https://asitis.app), the markdown editor that never rewrites your file. MIT licensed.

- **No writes.** There is no write, patch or delete tool, and no write code in the server.
- **No network.** No telemetry, no update check, no remote calls. It speaks MCP over stdio only.
- **One folder.** It reads only markdown under the folder you start it with.

| Part | Where | What it is |
|---|---|---|
| MCP server `@asitis/mcp` | [`packages/mcp`](packages/mcp) | Five read-only tools for any MCP client. One bundled file, zero runtime dependencies. |
| Claude Code plugin `asitis` | [`plugins/asitis`](plugins/asitis) | The server (vendored, pinned by SHA-256, run under Node's permission model), a byte-clean editing skill, `/asitis:md-lint`, `/asitis:md-budget` and an optional accident guard hook. |
| Fixtures | [`test-fixtures`](test-fixtures) | Byte-exact simulated steering files and encodings used by the tests. |

This repository is also a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`).

## Install

Requires Node 22.13 or later on your `PATH`.

### Claude Code (plugin)

```bash
claude plugin marketplace add Katta041/asitis-agent-tools
claude plugin install asitis@asitis
```

Inside a session, `/plugin marketplace add Katta041/asitis-agent-tools` and `/plugin install asitis@asitis` do the same. Remove it with `claude plugin marketplace remove asitis`.

From a local clone instead:

```bash
git clone https://github.com/Katta041/asitis-agent-tools.git
claude plugin marketplace add ./asitis-agent-tools
claude plugin install asitis@asitis
```

Or try it for one session without installing: `claude --plugin-dir ./asitis-agent-tools/plugins/asitis`.

The plugin never downloads the server at runtime. See [`plugins/asitis/README.md`](plugins/asitis/README.md) for the skill, commands, guard hook and options.

### Other MCP clients (Claude Desktop, Cursor, Codex, Gemini CLI)

`@asitis/mcp` is **not on npm yet (coming soon)**. Until it is, run the server from a clone. The plugin folder already contains the built, pinned server, so no install or build step is needed:

```bash
git clone https://github.com/Katta041/asitis-agent-tools.git
node asitis-agent-tools/plugins/asitis/server/asitis-mcp.mjs --version
```

Use `node` as the command and the absolute path to `plugins/asitis/server/asitis-mcp.mjs` as the first argument. Client configs are always started outside your project, so give `--root` as an absolute path.

**Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows.

```json
{
  "mcpServers": {
    "asitis": {
      "command": "node",
      "args": ["/absolute/path/to/asitis-agent-tools/plugins/asitis/server/asitis-mcp.mjs", "--root", "/absolute/path/to/project"]
    }
  }
}
```

**Cursor**: `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json`).

```json
{
  "mcpServers": {
    "asitis": {
      "command": "node",
      "args": ["/absolute/path/to/asitis-agent-tools/plugins/asitis/server/asitis-mcp.mjs", "--root", "${workspaceFolder}"]
    }
  }
}
```

If your Cursor version does not expand `${workspaceFolder}`, use an absolute path. The server refuses a root that still contains `${...}` rather than guessing.

**Codex** (CLI, IDE and desktop): `~/.codex/config.toml`.

```toml
[mcp_servers.asitis]
command = "node"
args = ["/absolute/path/to/asitis-agent-tools/plugins/asitis/server/asitis-mcp.mjs", "--root", "/absolute/path/to/project"]
```

**Gemini CLI**: `.gemini/settings.json` in the project (or `~/.gemini/settings.json`).

```json
{
  "mcpServers": {
    "asitis": {
      "command": "node",
      "args": ["/absolute/path/to/asitis-agent-tools/plugins/asitis/server/asitis-mcp.mjs", "--root", "/absolute/path/to/project"]
    }
  }
}
```

**Once `@asitis/mcp` is on npm**, replace `"command": "node"` and the file path with `"command": "npx"` and `"-y", "@asitis/mcp@0.1.0"`, for example `"args": ["-y", "@asitis/mcp@0.1.0", "--root", "/absolute/path/to/project"]`. Always pin the version; never use `@latest` in an agent config.

**Hardened**: add Node's permission model so the runtime itself denies writes, network and child processes. This is what the Claude Code plugin does:

```bash
node --permission \
  --allow-fs-read=/absolute/path/to/asitis-agent-tools/plugins/asitis \
  --allow-fs-read=/absolute/path/to/project \
  /absolute/path/to/asitis-agent-tools/plugins/asitis/server/asitis-mcp.mjs --root /absolute/path/to/project
```

Put the same flags at the front of `args` in any config above.

## What it checks

| Tool | What it returns |
|---|---|
| `read_markdown` | The file text exactly as stored, plus a byte profile: encoding, BOM, CRLF/LF/CR counts, final newline, trailing whitespace, invalid UTF-8 byte ranges, sha256. Pages large files. `as: "base64"` returns the exact bytes. Labels the content as untrusted and summarises hidden characters and comments. |
| `outline` | ATX and setext headings with line numbers, skipping frontmatter and fenced code. |
| `lint_steering` | Frontmatter on line 1 and valid YAML; required `name` and `description` for SKILL.md and subagents; unknown keys; length against vendor limits; broken relative links and `@path` imports; zero-width, bidi and other invisible characters; hidden HTML comments that read like instructions; text hidden with inline styles; duplicate and contradictory-looking rules. With no path, lints every steering file in the folder. |
| `context_budget` | Approximate tokens per file and per tool for what loads every session: Claude Code (CLAUDE.md plus `@imports` up to 4 hops, rules without `paths`, MEMORY.md first 200 lines, the skill and subagent listing), Codex (AGENTS.md, 32 KiB cap), Gemini CLI (GEMINI.md plus imports), Cursor always-applied rules, Copilot repository instructions. |
| `find_steering_files` | Every steering file, grouped by when it loads: every session, on match (`paths`, `globs`, `applyTo`), on invocation (skills, commands, agents, prompts), on demand (nested instruction files), memory. |

Vendor limits, with sources cited in [`packages/mcp/src/limits.ts`](packages/mcp/src/limits.ts):

| File | Limit |
|---|---|
| CLAUDE.md | target under 200 lines (Claude Code memory docs) |
| SKILL.md | under 500 lines; `description` plus `when_to_use` truncated at 1,536 characters in the listing (Claude Code skills docs); `name` up to 64 and `description` up to 1,024 characters (Agent Skills spec) |
| MEMORY.md | first 200 lines or 25 KB load (Claude Code memory docs) |
| AGENTS.md | 32 KiB read by Codex by default (`project_doc_max_bytes`) |
| Cursor rules | under 500 lines |
| Windsurf rules | 12,000 characters |

Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`. Every result ends with one line, `Edit these files without rewriting them: https://asitis.app/?ref=mcp`. Turn it off with `--no-footer` (or `--footer false`, or `ASITIS_MCP_FOOTER=0`, or the plugin option `footer`).

## Privacy

- The server and the guard hook make no network connections and contain no network code. They collect nothing and send nothing.
- They never write, rename or delete a file, and create no temp files.
- The server logs one start-up line to stderr (version and root folder), never file content.
- **What your assistant does with results is up to your assistant.** Tool results go into the model's context, so they reach whichever AI provider your assistant uses. That is your assistant's network traffic, not ours.

## Security model

- **Root confinement.** Every path is resolved with `realpath` and must stay inside a root given at start-up. `../` traversal, absolute paths outside the root and symlinks that resolve outside are refused. The filesystem root and your home folder are refused as roots unless you pass `--allow-broad-root`.
- **Markdown only.** Only `.md`, `.mdc`, `.markdown`, `.mdx`, `.cursorrules`, `.windsurfrules` and `.clinerules` are read. `.env*`, `.claude/settings*.json`, anything in `.git/` or `node_modules/`, and every other file type are refused, including through a markdown-named symlink that points at them. `@imports` of such files are counted from their size, never read.
- **Bounded work.** Files over 16 MB are refused (`--max-file-mb`), results are capped, every tool call has a 20 s budget, and every scanner is linear time. The tests run 10 MB adversarial inputs (unclosed comments, bracket and backtick storms, long import tokens, invalid UTF-8 and more) through every tool under a 3 s per-call budget.
- **Untrusted content.** `read_markdown` labels file content as data, not instructions, and reports hidden instructions and invisible characters up front. This does not stop a model from obeying text it reads; it makes the text visible.
- **Pinned server in the plugin.** `plugins/asitis/server/asitis-mcp.mjs` is the exact build of `packages/mcp` for this version, and `server/VERSION` records its SHA-256. A test fails if it differs from a fresh build.

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Limits

- Token counts are local approximations (about 4 characters per token for English), not any vendor's tokenizer.
- A hardlink inside the root to a file elsewhere is read like any other file (reads only).
- A symlink swapped into a parent folder between the check and the open is a narrow race; the final path component is opened with `O_NOFOLLOW` and checked by inode.
- Windows junctions and case-insensitive volumes have had less testing than macOS and Linux.
- The guard hook is an accident guard, not a security boundary: it does not see `Bash` (`sed -i`, redirects) or other programs.
- Lint rules follow the vendors' public docs at the time of release. When a vendor changes a limit, the number in `limits.ts` needs updating.

## Options

```
asitis-mcp --root <folder> [--root <folder>...] [options]

  --root <folder>      Folder the server may read (repeatable). Default: the current folder.
  --no-footer          Do not end tool results with the asitis.app line.
  --max-file-mb <n>    Largest file to analyse, in MB (default 16, max 64).
  --allow-broad-root   Allow your home folder or the filesystem root as the root.
  --version            Print the version.
  --help               Print this help.
```

`ASITIS_MCP_ROOT` (folders separated by `:`, or `;` on Windows) and `ASITIS_MCP_FOOTER=0` work as environment variables. Add a second `--root` for a memory folder that lives outside the project.

Mistakes print one line and exit with code 2, for example:

```
asitis-mcp: Root folder not found: /x. Pass an existing folder with --root.
```

## Develop

```bash
npm ci            # installs the pinned dev dependencies; there are no install scripts
npm test          # typecheck, bundle, then the full Vitest suite
npm run sync-plugin   # rebuild the server and copy it, with its SHA-256, into plugins/asitis/server
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). The bundled server includes open-source dependencies under their own licences, listed in `plugins/asitis/server/THIRD_PARTY_NOTICES.md`.

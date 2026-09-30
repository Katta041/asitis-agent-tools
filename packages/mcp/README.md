# @asitis/mcp

**Read-only MCP server for markdown and AI agent steering files.** From [AsItIs](https://asitis.app/?ref=npm), the markdown editor that never rewrites your file. MIT licensed. Source, issues and the Claude Code plugin: [github.com/Katta041/asitis-agent-tools](https://github.com/Katta041/asitis-agent-tools).

It gives your coding agent five tools to read, outline, lint and budget `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `SKILL.md`, subagents, commands, rules, Cursor `.mdc` rules, Copilot instructions and memory files, without being able to change any of them.

- **No writes.** There is no write, patch or delete tool, and no write code in the package.
- **No network.** No telemetry, no update check, no remote calls. It speaks MCP over stdio only.
- **One folder.** It reads only markdown under the folder you start it with.

## Tools

| Tool | What it returns |
|---|---|
| `read_markdown` | The file text exactly as stored, plus a byte profile: encoding, BOM, CRLF/LF/CR counts, final newline, trailing whitespace, invalid UTF-8 byte ranges, sha256. Pages large files (`offset_bytes`, `max_bytes`, 256 KB default, 1 MB max). `as: "base64"` returns the exact bytes. Marks the content as untrusted and summarises hidden characters and comments. |
| `outline` | ATX and setext headings with line numbers, skipping frontmatter and fenced code. |
| `lint_steering` | Frontmatter on line 1 and valid YAML; required `name` and `description` for SKILL.md and subagents; unknown keys; length against vendor limits; broken relative links and `@path` imports; zero-width, bidi and other invisible characters; hidden HTML comments that read like instructions; text hidden with inline styles; duplicate and contradictory-looking rules. With no path, lints every steering file in the folder. |
| `context_budget` | Approximate tokens per file and per tool for what loads every session: Claude Code (CLAUDE.md plus `@imports` up to 4 hops, rules without `paths`, MEMORY.md first 200 lines, the skill and subagent listing), Codex (AGENTS.md, 32 KiB cap), Gemini CLI (GEMINI.md plus imports), Cursor always-applied rules, Copilot repository instructions. |
| `find_steering_files` | Every steering file, grouped by when it loads: every session, on match (`paths`, `globs`, `applyTo`), on invocation (skills, commands, agents, prompts), on demand (nested instruction files), memory. |

Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`. Every result ends with one line, `Edit these files without rewriting them: https://asitis.app/?ref=mcp`. Turn it off with `--no-footer` (or `--footer false`, or `ASITIS_MCP_FOOTER=0`).

Vendor limits checked, with sources in [`src/limits.ts`](src/limits.ts):

| File | Limit |
|---|---|
| CLAUDE.md | target under 200 lines (Claude Code memory docs) |
| SKILL.md | under 500 lines; `description` plus `when_to_use` truncated at 1,536 characters in the listing (Claude Code skills docs); `name` up to 64 and `description` up to 1,024 characters (Agent Skills spec) |
| MEMORY.md | first 200 lines or 25 KB load (Claude Code memory docs) |
| AGENTS.md | 32 KiB read by Codex by default (`project_doc_max_bytes`) |
| Cursor rules | under 500 lines |
| Windsurf rules | 12,000 characters |

## Privacy

- The server makes no network connections and has no network code. It collects nothing and sends nothing.
- It never writes, renames or deletes a file, and creates no temp files.
- It logs one start-up line to stderr (version and root folder), never file content.
- **What your assistant does with results is up to your assistant.** Tool results go into the model's context, so they reach whichever AI provider your assistant uses. That is your assistant's network traffic, not ours.

## Security model

- **Root confinement.** Every path is resolved with `realpath` and must stay inside a root given at start-up. `../` traversal, absolute paths outside the root and symlinks (file or folder) that resolve outside are refused. The filesystem root and your home folder are refused as roots unless you pass `--allow-broad-root`.
- **Markdown only.** Only `.md`, `.mdc`, `.markdown`, `.mdx`, `.cursorrules`, `.windsurfrules` and `.clinerules` are read. `.env*`, `.claude/settings*.json`, anything in `.git/` or `node_modules/`, and every other file type are refused, including through a markdown-named symlink that points at them. `@imports` of such files are counted from their size, never read.
- **Bounded work.** Files over 16 MB are refused (`--max-file-mb`), results are capped, every tool call has a 20 s budget, and every scanner is linear time. The test suite runs 32 adversarial 10 MB inputs (unclosed comments, bracket and backtick storms, 2,000-character import tokens, invalid UTF-8 and more) through every tool under a 3 s per-call budget.
- **Untrusted content.** `read_markdown` labels file content as data, not instructions, and reports hidden instructions and invisible characters up front. This does not stop a model from obeying text it reads; it makes the text visible.
- **Stronger sandbox, optional.** Run the server under Node's permission model so the runtime itself forbids writes, network and child processes (see below). The Claude Code plugin does this by default.

Known limits: token counts are local approximations (about 4 characters per token for English). A hardlink inside the root to a file elsewhere is read like any other file (reads only). A symlink swapped into a parent folder between the check and the open is a narrow race; the final path component is opened with `O_NOFOLLOW` and checked by inode. Windows junctions and case-insensitive volumes have not been tested yet.

## Install

Requires Node 22.13 or later.

> **Not on npm yet (coming soon).** Until `@asitis/mcp` is published, run the pinned build from a clone of the repository, which needs no install or build step: `git clone https://github.com/Katta041/asitis-agent-tools.git`, then use `node` with the absolute path to `plugins/asitis/server/asitis-mcp.mjs` wherever the configs below say `npx -y @asitis/mcp@0.1.0`. The [repository README](https://github.com/Katta041/asitis-agent-tools#other-mcp-clients-claude-desktop-cursor-codex-gemini-cli) has those configs written out.

Always pin the version; never use `@latest` in an agent config.

### Claude Code

Use the plugin (skill, commands and guard hook included):

```bash
claude plugin marketplace add Katta041/asitis-agent-tools
claude plugin install asitis@asitis
```

Or add only the server: `claude mcp add asitis -- npx -y @asitis/mcp@0.1.0 --root "$PWD"`.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Claude Desktop starts servers outside your project, so the root must be an absolute path:

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["-y", "@asitis/mcp@0.1.0", "--root", "/absolute/path/to/project"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["-y", "@asitis/mcp@0.1.0", "--root", "${workspaceFolder}"]
    }
  }
}
```

If your Cursor version does not expand `${workspaceFolder}`, use an absolute path. The server refuses a root that still contains `${...}` rather than guessing.

### Codex (CLI, IDE and desktop)

`~/.codex/config.toml`:

```toml
[mcp_servers.asitis]
command = "npx"
args = ["-y", "@asitis/mcp@0.1.0", "--root", "/absolute/path/to/project"]
```

### Gemini CLI

`.gemini/settings.json` in the project (or `~/.gemini/settings.json`):

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["-y", "@asitis/mcp@0.1.0", "--root", "/absolute/path/to/project"]
    }
  }
}
```

### Hardened: Node's permission model

Run the file directly under Node's permission model so Node itself denies writes, network and child processes:

```bash
npm install -g @asitis/mcp@0.1.0
node --permission \
  --allow-fs-read="$(npm root -g)/@asitis/mcp" \
  --allow-fs-read=/absolute/path/to/project \
  "$(npm root -g)/@asitis/mcp/dist/asitis-mcp.mjs" --root /absolute/path/to/project
```

Use the same `command` and `args` in any of the configs above.

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

`ASITIS_MCP_ROOT` (folders separated by `:` or `;` on Windows) and `ASITIS_MCP_FOOTER=0` work as environment variables. Add a second `--root` for a memory folder that lives outside the project, for example `~/.claude/projects/<project>/memory`.

Mistakes print one line and exit with code 2, for example `asitis-mcp: Root folder not found: /x. Pass an existing folder with --root.`

## Package

The package is one file, `dist/asitis-mcp.mjs` (esbuild, minified), with zero runtime dependencies and no install scripts. The MCP SDK (pinned to 1.31.0), zod and yaml are bundled in; their licences are in `dist/THIRD_PARTY_NOTICES.md`. Releases are published from GitHub Actions with npm trusted publishing and provenance; check them with `npm audit signatures`.

## License

MIT. Report vulnerabilities privately through [GitHub security advisories](https://github.com/Katta041/asitis-agent-tools/security/advisories/new).

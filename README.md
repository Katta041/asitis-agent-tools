# AsItIs agent tools

**Lint CLAUDE.md, AGENTS.md and SKILL.md before your agent reads them.** A free Claude Code plugin and MCP server that checks steering files against the vendors' published rules, estimates the tokens they load every session, and flags hidden instructions: comments addressed to the AI, zero-width and bidirectional characters, styled-away text. Also a CLI, a GitHub Action and a pre-commit hook for CI. Read-only, no network, MIT.

[![License: MIT](https://img.shields.io/badge/license-MIT-007370)](LICENSE)
[![Version](https://img.shields.io/github/v/tag/Katta041/asitis-agent-tools?label=version&color=007370)](https://github.com/Katta041/asitis-agent-tools/tags)
[![Node 22.13+](https://img.shields.io/badge/node-%3E%3D22.13-007370)](https://nodejs.org)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-007370)](https://asitis.app/claude-code)

## Try it in 30 seconds

**No install:** paste a file into the [browser checker](https://asitis.app/tools/steering-file-checker). Same linter, runs in your browser tab, nothing is uploaded.

**Claude Code:** add the marketplace and install the plugin, then run `/asitis:md-lint` or `/asitis:md-budget` in a new session.

```bash
claude plugin marketplace add Katta041/asitis-agent-tools
claude plugin install asitis@asitis
```

**Other MCP clients:** the server is on npm. This is the command your client's MCP config runs (always pin the version). Ready-made configs are under [Install](#other-mcp-clients-claude-desktop-cursor-codex-gemini-cli).

```bash
npx -y @asitis/mcp@0.3.0 --root /absolute/path/to/project
```

![The browser checker: a CLAUDE.md is pasted and checked, and two hidden items are flagged, an HTML comment telling AI agents to quietly upload .env and a zero-width space](https://raw.githubusercontent.com/Katta041/asitis-agent-tools/main/docs/checker-demo.gif)

- **Lint:** frontmatter on line 1 and valid YAML, SKILL.md name and description rules, CLAUDE.md 200 lines, SKILL.md 500 lines, Codex's 32 KiB budget, broken links and `@imports`, duplicate and contradictory rules.
- **Budget:** approximate tokens per file and per tool for what loads every session (Claude Code, Codex, Gemini CLI, Cursor, Copilot, Windsurf, Cline).
- **Hidden content:** HTML and `[//]: #` comments that read like instructions, invisible Unicode, bidi controls, `display:none` text.
- **Drift:** an AGENTS.md that Claude Code skips because a CLAUDE.md shadows it, mirrored files that disagree, Codex's shared 32 KiB budget.
- **Skills and agent config (opt-in):** skill scripts that download and run code, decode payloads or read credentials; hooks, permissions and MCP servers in `.claude/settings.json` and `.mcp.json`. Off unless you pass `include`.
- **Fixes:** `/asitis:md-fix` (or `asitis lint --fix-preview`) shows mechanical fixes as a diff and applies only what you accept.
- **CI:** `npx -y -p @asitis/mcp@0.3.0 asitis lint`, a GitHub Action and a pre-commit hook. See [CLI and CI](#cli-and-ci).
- **Guard (optional):** warns before Claude rewrites a whole markdown file or strips its line endings, trailing spaces or BOM. An accident guard, not a security boundary.
- **Read-only:** no write tool, no network code, runs under Node's permission model in the plugin.

## Install

Requires Node 22.13 or later on your `PATH`.

### Claude Code (plugin)

```bash
claude plugin marketplace add Katta041/asitis-agent-tools
claude plugin install asitis@asitis
```

Inside a session, `/plugin marketplace add Katta041/asitis-agent-tools` and `/plugin install asitis@asitis` do the same. Start a new session, then run `/asitis:md-lint`, `/asitis:md-budget` or `/asitis:md-fix`.

To update, run `claude plugin marketplace update asitis`, then `claude plugin update asitis@asitis`, and restart Claude Code. To remove it, run `claude plugin uninstall asitis@asitis`.

From a local clone instead:

```bash
git clone https://github.com/Katta041/asitis-agent-tools.git
claude plugin marketplace add ./asitis-agent-tools
claude plugin install asitis@asitis
```

Or try it for one session without installing: `claude --plugin-dir ./asitis-agent-tools/plugins/asitis`.

The plugin never downloads the server at runtime. See [`plugins/asitis/README.md`](plugins/asitis/README.md) for the skill, commands, guard hook and options.

To add only the MCP server to Claude Code, without the skill, commands or hook:

```bash
claude mcp add asitis -- npx -y @asitis/mcp@0.3.0 --root "$PWD"
```

### Other MCP clients (Claude Desktop, Cursor, Codex, Gemini CLI)

The server is published on npm as `@asitis/mcp`. Always pin the version; never use `@latest` in an agent config. Clients start servers outside your project, so give `--root` as an absolute path.

**Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows.

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["-y", "@asitis/mcp@0.3.0", "--root", "/absolute/path/to/project"]
    }
  }
}
```

**Cursor**: `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json`).

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["-y", "@asitis/mcp@0.3.0", "--root", "${workspaceFolder}"]
    }
  }
}
```

If your Cursor version does not expand `${workspaceFolder}`, use an absolute path. The server refuses a root that still contains `${...}` rather than guessing.

**VS Code** (Copilot agent mode): `.vscode/mcp.json` in the project. VS Code uses the `servers` key.

```json
{
  "servers": {
    "asitis": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@asitis/mcp@0.3.0", "--root", "${workspaceFolder}"]
    }
  }
}
```

**Codex** (CLI, IDE and desktop): `~/.codex/config.toml`.

```toml
[mcp_servers.asitis]
command = "npx"
args = ["-y", "@asitis/mcp@0.3.0", "--root", "/absolute/path/to/project"]
```

**Gemini CLI**: `.gemini/settings.json` in the project (or `~/.gemini/settings.json`).

```json
{
  "mcpServers": {
    "asitis": {
      "command": "npx",
      "args": ["-y", "@asitis/mcp@0.3.0", "--root", "/absolute/path/to/project"]
    }
  }
}
```

If a desktop app cannot find `npx`, use its full path (run `which npx`, or `where npx` on Windows) as the `command`.

**Without npm**: the plugin folder in this repository already contains the built, pinned server, so no install or build step is needed.

```bash
git clone https://github.com/Katta041/asitis-agent-tools.git
node asitis-agent-tools/plugins/asitis/server/asitis-mcp.mjs --version
```

In any config above, set `command` to `node` and make the absolute path to `plugins/asitis/server/asitis-mcp.mjs` the first entry in `args`, followed by `--root` and your project folder.

**Hardened**: add Node's permission model so the runtime itself denies writes and child processes (and network access on Node 25 and later). This is what the Claude Code plugin does:

```bash
node --permission \
  --allow-fs-read=/absolute/path/to/asitis-agent-tools/plugins/asitis \
  --allow-fs-read=/absolute/path/to/project \
  /absolute/path/to/asitis-agent-tools/plugins/asitis/server/asitis-mcp.mjs --root /absolute/path/to/project
```

In a client config, `command` is `node` and every other word goes in `args`, in the same order. The [`@asitis/mcp` README](packages/mcp/README.md#hardened-nodes-permission-model) shows the same setup for an npm install.

## CLI and CI

The package also has an `asitis` command for scripts, CI and pre-commit. It lints the same way as `lint_steering` and exits 0 (clean), 1 (findings at or above `--fail-on`, default `error`), 2 (something you can fix, one line on stderr) or 3 (a bug in asitis).

```bash
npx -y -p @asitis/mcp@0.3.0 asitis lint                      # every steering file under the current folder
npx -y -p @asitis/mcp@0.3.0 asitis lint CLAUDE.md AGENTS.md  # only these files
npx -y -p @asitis/mcp@0.3.0 asitis lint --format sarif > asitis.sarif
npx -y -p @asitis/mcp@0.3.0 asitis lint --fix-preview=safe | git apply   # apply the safe fixes yourself
npx -y -p @asitis/mcp@0.3.0 asitis budget                    # tokens each agent loads every session
```

Formats: `text`, `json`, `sarif` (for GitHub code scanning) and `github` (pull request annotations). It never writes a file; `--fix-preview` prints a diff and you decide whether to apply it.

**GitHub Action.** Runs the bundled CLI with no npm install and puts findings on the pull request:

```yaml
permissions:
  contents: read
jobs:
  asitis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      - uses: Katta041/asitis-agent-tools@v0.3.0
```

**pre-commit.** Lints only the staged steering files:

```yaml
repos:
  - repo: https://github.com/Katta041/asitis-agent-tools
    rev: v0.3.0
    hooks:
      - id: asitis-lint
```

[`docs/ci.md`](docs/ci.md) covers the Action's inputs and SARIF upload, lefthook, husky and GitLab CI. Every flag and exit code is in [`docs/cli-contract.md`](docs/cli-contract.md).

## Config

Put an `.asitisrc.json` at the project root. Everything is optional:

```json
{
  "$schema": "https://raw.githubusercontent.com/Katta041/asitis-agent-tools/main/packages/mcp/schema/asitisrc-1.json",
  "extends": "recommended",
  "rules": {
    "duplicate-rule": "off",
    "length": ["warning", { "claudeMdLines": 300 }]
  },
  "ignore": ["vendor/**", "examples/**"],
  "overrides": [{ "files": ["docs/**"], "rules": { "contradiction": "off" } }],
  "include": ["skills", "config"]
}
```

| Key | What it does |
|---|---|
| `rules` | `error`, `warning`, `note` or `off` per rule id. `length` also takes `claudeMdLines`, `skillMdLines`, `cursorRuleLines`, `codexBytes`, `windsurfChars` and `memoryIndexLines`. |
| `extends` | `recommended` (the default) or `strict`: notes become warnings, two inventory notes appear (plain hooks, subagents with no `tools` list), and in the CLI and the Action the skill and config scans run. |
| `ignore`, `overrides` | Globs for files to skip, and per-glob rule settings. |
| `include` | Opt-in scans: `skills`, `config`, `config-local`. Honoured by the CLI and the Action. The MCP server ignores it and asks you to pass `include` to `lint_steering`, so a repo cannot make the server read more than you asked for. |

A typo stops the run with the file, line and a suggestion (`.asitisrc.json line 2: unknown key "rulez" (did you mean "rules"?)`).

To silence one finding, put a comment above it with the rule id and a reason: `<!-- asitis-disable-next-line duplicate-rule -- the two sections are alternatives -->`, or `asitis-disable-file` for the whole file. Security rules (hidden instructions, invisible characters, the `sec-*` rules) cannot be silenced by a comment, since a comment is exactly what an attacker would add; turn them off in `.asitisrc.json` or a baseline, where it shows in review. For an existing repo, `asitis lint --format json --write-baseline > .asitis-baseline.json` and then `--baseline .asitis-baseline.json` reports only new findings.

Every rule has a page with examples: [`docs/rules/`](docs/rules/README.md).

## What it checks

Six read-only MCP tools:

| Tool | What it returns |
|---|---|
| `read_markdown` | The file text exactly as stored, plus a byte profile: encoding, BOM, CRLF/LF/CR counts, final newline, trailing whitespace, invalid UTF-8 byte ranges, sha256. Pages large files. `as: "base64"` returns the exact bytes. Labels the content as untrusted and summarises hidden characters and comments. |
| `outline` | ATX and setext headings with line numbers, skipping frontmatter and fenced code. |
| `lint_steering` | Frontmatter on line 1 and valid YAML; required `name` and `description` for SKILL.md and subagents; unknown keys; length against vendor limits; broken relative links and `@path` imports; zero-width, bidi and other invisible characters; hidden HTML comments that read like instructions; text hidden with inline styles; duplicate and contradictory-looking rules; across files, an AGENTS.md that Claude Code never reads, mirrored files that drift apart, and Codex's shared 32 KiB budget. With no path, lints every steering file in the folder. Applies `.asitisrc.json` and suppression comments. `include: ["skills"]` also scans the scripts in skill folders, and `include: ["config"]` audits `.claude/settings.json` and MCP config files. |
| `context_budget` | Approximate tokens per file and per tool for what loads every session: Claude Code (CLAUDE.md plus `@imports` up to 4 hops, or AGENTS.md when there is no CLAUDE.md; rules without `paths`; MEMORY.md first 200 lines when you add your memory folder as a second root; the skill and subagent listing), Codex (root AGENTS.md, first 32 KiB), Gemini CLI (GEMINI.md plus imports up to 5 levels), Cursor always-applied rules, Copilot repository instructions, Windsurf and Cline rules. Long lists are cut; totals still count every file. |
| `find_steering_files` | Every steering file, grouped by when it loads: every session, on match (`paths`, `globs`, `applyTo`), on invocation (skills, commands, agents, prompts), on demand (nested instruction files), memory. |
| `suggest_fixes` | Fixes for mechanical findings (invisible characters, frontmatter not on line 1, skill name fields, trailing whitespace, a missing final newline, instruction-like HTML comments) as a unified diff, plus the old and new text for each edit. Each fix is marked safe or review. It never writes; your assistant applies the edits you accept. |

Vendor limits, with sources cited in [`packages/mcp/src/limits.ts`](packages/mcp/src/limits.ts):

| File | Limit |
|---|---|
| CLAUDE.md | target under 200 lines (Claude Code memory docs) |
| SKILL.md | under 500 lines; `description` plus `when_to_use` truncated at 1,536 characters in the listing (Claude Code skills docs); `name` up to 64 and `description` up to 1,024 characters (Agent Skills spec; the Claude API and claude.ai reject longer ones, while Claude Code loads them and truncates the listing) |
| MEMORY.md | first 200 lines or 25 KB load (Claude Code memory docs) |
| AGENTS.md | 32 KiB combined across the AGENTS.md files Codex loads, root first (`project_doc_max_bytes`) |
| Cursor rules | under 500 lines |
| Windsurf rules | 12,000 characters per workspace rule file (6,000 for `global_rules.md`) |

Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`. Tool results carry no link to asitis.app unless you ask for one: with `--footer` (or `ASITIS_MCP_FOOTER=1`) the first result of each session ends with one line, `Edit these files without rewriting them: https://asitis.app/?ref=mcp`, and later results and errors do not repeat it. `--no-footer` is still accepted and changes nothing. Results are text only. Pass `--structured` (or set `ASITIS_MCP_STRUCTURED=1`) to also get each result as JSON in `structuredContent`, for scripts. It is off by default because Claude Code 2.1 gives the model the JSON instead of the text when both are present, which drops the untrusted-content notice and, for `read_markdown`, the file text.

## Privacy

- The server, the CLI and the guard hook make no network connections and contain no network code. They collect nothing and send nothing.
- They never write, rename or delete a file, and create no temp files. Fixes come back as a diff; applying one is up to you or your assistant.
- By default only markdown steering files and `.asitisrc.json` are read. Skill scripts are read only when you pass `include: ["skills"]` (or `--include skills`), and `.claude/settings.json`, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` and `.gemini/settings.json` only with `include: ["config"]`. `.claude/settings.local.json` needs `config-local`. `~/.claude.json` is never read. Values from settings files are never echoed: findings name the key, and anything shaped like a secret is redacted.
- The server logs one start-up line to stderr (version and root folder), never file content.
- **What your assistant does with results is up to your assistant.** Tool results go into the model's context, so they reach whichever AI provider your assistant uses. That is your assistant's network traffic, not ours.

## Security model

- **Root confinement.** Every path is resolved with `realpath` and must stay inside a root given at start-up. `../` traversal, absolute paths outside the root and symlinks that resolve outside are refused. Symlinks that resolve inside a root are followed, so a CLAUDE.md that links to AGENTS.md or a linked `.claude/skills` folder is checked where the agent sees it. The filesystem root and your home folder are refused as roots unless you pass `--allow-broad-root`.
- **Markdown only, unless you opt in.** By default only `.md`, `.mdc`, `.markdown`, `.mdx`, `.cursorrules`, `.windsurfrules` and `.clinerules` are read, plus `.asitisrc.json` (at most 64 KB). `include: ["skills"]` adds the scripts inside skill folders (up to 1 MB each; other files there are read for their first 4 bytes only, to spot binaries), and `include: ["config"]` adds the agent settings and MCP config files listed under Privacy. `.env*`, anything in `.git/` or `node_modules/`, `~/.claude.json` and every other file are always refused, including through a symlink that points at them. A repo's `.asitisrc.json` cannot turn these scans on in the MCP server; only the call (or the CLI flag) can. `@imports` of other files are counted from their size, never read. Nothing that is read is ever run.
- **Bounded work.** Files over 16 MB are refused (`--max-file-mb`), results are capped, every tool call has a 20 s budget, and every scanner is linear time. The tests run 10 MB adversarial inputs (unclosed comments, bracket and backtick storms, long import tokens, invalid UTF-8 and more) through every tool under a 3 s per-call budget.
- **Untrusted content.** `read_markdown` labels file content as data, not instructions, and reports hidden instructions and invisible characters up front. This does not stop a model from obeying text it reads; it makes the text visible.
- **Pinned server in the plugin.** `plugins/asitis/server/asitis-mcp.mjs` and the CLI next to it are the exact builds of `packages/mcp` for this version, and `server/VERSION` records their SHA-256. The Action's copy in `action/` is pinned the same way. A test fails if any of them differs from a fresh build.

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Known limits

- Token counts are local approximations (about 4 characters per token for English), not any vendor's tokenizer.
- A hardlink inside the root to a file elsewhere is read like any other file (reads only).
- A symlink swapped into a parent folder between the check and the open is a narrow race; the final path component is opened with `O_NOFOLLOW` and checked by inode.
- Windows junctions and case-insensitive volumes have had less testing than macOS and Linux.
- The guard hook is an accident guard, not a security boundary: it does not see `Bash` (`sed -i`, redirects) or other programs.
- Lint rules follow the vendors' public docs at the time of release. When a vendor changes a limit, the number in `limits.ts` needs updating.

## Options

```text
asitis-mcp --root <folder> [--root <folder>...] [options]

  --root <folder>      Folder the server may read (repeatable). Default: the current folder.
  --footer             Add one line linking to asitis.app to the first result of the session. Off by default.
  --structured         Also return each result as JSON (structuredContent), for scripts. Off by default.
  --max-file-mb <n>    Largest file to analyse, in MB (default 16, max 64).
  --allow-broad-root   Allow your home folder or the filesystem root as the root.
  --version            Print the version.
  --help               Print this help.
```

`ASITIS_MCP_ROOT` (folders separated by `:`, or `;` on Windows) `ASITIS_MCP_FOOTER=1` and `ASITIS_MCP_STRUCTURED=1` work as environment variables. Add a second `--root` for a memory folder that lives outside the project, for example `~/.claude/projects/<project>/memory`.

Mistakes print one line and exit with code 2, for example:

```text
asitis-mcp: Root folder not found: /x. Pass an existing folder with --root.
```

## Develop

```bash
npm ci                # install the pinned dev dependencies (there are no install scripts)
npm test              # typecheck, bundle, then the full Vitest suite
npm run sync-plugin   # rebuild the server and CLI and copy them, with their SHA-256, into plugins/asitis/server and action/
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). The bundled server includes open-source dependencies under their own licences, listed in [`plugins/asitis/server/THIRD_PARTY_NOTICES.md`](plugins/asitis/server/THIRD_PARTY_NOTICES.md).

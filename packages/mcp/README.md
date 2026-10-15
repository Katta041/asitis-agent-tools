# @asitis/mcp

**Read-only MCP server for markdown and AI agent steering files.** From [AsItIs](https://asitis.app/?ref=npm), the markdown editor that never rewrites your file. MIT licensed. Source, issues and the Claude Code plugin: [github.com/Katta041/asitis-agent-tools](https://github.com/Katta041/asitis-agent-tools).

It gives your coding agent six tools to read, outline, lint, budget and suggest fixes for `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `SKILL.md`, subagents, commands, rules, Cursor `.mdc` rules, Copilot instructions and memory files, without being able to change any of them. The same package has an `asitis` command for CI and pre-commit.

- **No writes.** There is no write, patch or delete tool, and no write code in the package.
- **No network.** No telemetry, no update check, no remote calls. It speaks MCP over stdio only.
- **Your folder only.** It reads only markdown files under the folder (or folders) you start it with, plus its own `.asitisrc.json` and the root `.gitmodules`, unless a call asks for the opt-in skill or config scan.

## Install

Requires Node 22.13 or later. Always pin the version; never use `@latest` in an agent config. MCP clients start servers outside your project, so give `--root` as an absolute path.

Check that it runs:

```bash
npx -y @asitis/mcp@0.3.0 --version
```

### Claude Code

Run this in your project folder:

```bash
claude mcp add asitis -- npx -y @asitis/mcp@0.3.0 --root "$PWD"
```

Or install the [Claude Code plugin](https://github.com/Katta041/asitis-agent-tools/blob/main/plugins/asitis/README.md), which adds a byte-clean editing skill, `/asitis:md-lint`, `/asitis:md-budget` and an optional guard hook, and runs this server under Node's permission model:

```bash
claude plugin marketplace add Katta041/asitis-agent-tools
claude plugin install asitis@asitis
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

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

### Cursor

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json`):

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

### VS Code

`.vscode/mcp.json` in the project (Copilot agent mode). VS Code uses the `servers` key, not `mcpServers`:

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

### Codex (CLI, IDE and desktop)

`~/.codex/config.toml`:

```toml
[mcp_servers.asitis]
command = "npx"
args = ["-y", "@asitis/mcp@0.3.0", "--root", "/absolute/path/to/project"]
```

### Gemini CLI

`.gemini/settings.json` in the project (or `~/.gemini/settings.json`):

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

### Hardened: Node's permission model

Run the file directly under Node's permission model so Node itself denies writes and child processes (and network access on Node 25 and later):

```bash
npm install -g @asitis/mcp@0.3.0
node --permission \
  --allow-fs-read="$(npm root -g)/@asitis/mcp" \
  --allow-fs-read=/absolute/path/to/project \
  "$(npm root -g)/@asitis/mcp/dist/asitis-mcp.mjs" --root /absolute/path/to/project
```

In a client config, `command` is `node` and every other word goes in `args`, in the same order. Replace `$(npm root -g)` with the folder that command prints, because configs do not run shell commands.

If a desktop app cannot find `npx` or `node`, use its full path (run `which npx`, or `where npx` on Windows) as the `command`.

## CLI and CI

The package also has an `asitis` command for scripts, CI and pre-commit. It lints the same way as `lint_steering` and exits 0 (clean), 1 (findings at or above `--fail-on`, default `error`), 2 (something you can fix, one line on stderr) or 3 (a bug in asitis).

```bash
npx -y -p @asitis/mcp@0.3.0 asitis lint                      # every steering file under the current folder
npx -y -p @asitis/mcp@0.3.0 asitis lint CLAUDE.md AGENTS.md  # only these files
npx -y -p @asitis/mcp@0.3.0 asitis lint --format sarif > asitis.sarif
npx -y -p @asitis/mcp@0.3.0 asitis lint --fix-preview=safe | git apply   # apply the safe fixes yourself
npx -y -p @asitis/mcp@0.3.0 asitis budget                    # tokens each agent loads every session
```

Formats: `text`, `json`, `sarif` (the standard report format GitHub code scanning reads) and `github` (pull request annotations). With `github`, only errors and warnings become annotations; add `--annotate-notes` to annotate notes as well. It never writes a file; `--fix-preview` prints a diff and you decide whether to apply it. `asitis lint --help` and `asitis budget --help` list each command's options.

```text
$ npx -y -p @asitis/mcp@0.3.0 asitis lint --include skills
.claude/skills/release/SKILL.md:4:1 warning sec-skill-allowed-tools allowed-tools pre-approves "Bash" (any shell command), so during the turn that invokes this skill those calls go ahead without asking you; scope each entry to the commands it needs, for example Bash(git status *) or WebFetch(domain:docs.example.com)

CLAUDE.md:7:1 warning duplicate-rule Same rule as line 5: "Run `pnpm test` before every commit". Duplicates cost context and drift apart when one is edited; keep one
CLAUDE.md:9:1 warning broken-link Relative link target not found: "docs/api.md". Fix the path or remove the link
CLAUDE.md:11:1 note hidden-comment 1 comment (HTML or [//]: # style) is hidden in rendered views on line 11: "maintainer note: keep this short". It does not read like an instruction to an agent; Claude Code strips it from CLAUDE.md at session start, though its Read tool and other agents still see it, so check that it says what you expect

Linted 2 files: 0 errors, 3 warnings, 1 note.
Skill scan: 1 skill folder, 0 scripts and 0 markdown files read, 0 other files checked for executable headers (0 files in all).
```

That run exits 0: with the default `--fail-on error` only errors fail the build. Pass `--fail-on warning` to fail on warnings too.

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

[`docs/ci.md`](https://github.com/Katta041/asitis-agent-tools/blob/main/docs/ci.md) covers the Action's inputs and SARIF upload, lefthook, husky and GitLab CI. Every flag and exit code is in [`docs/cli-contract.md`](https://github.com/Katta041/asitis-agent-tools/blob/main/docs/cli-contract.md).

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

To silence one finding, put a comment above it with the rule id: `<!-- asitis-disable-next-line duplicate-rule -- the two sections are alternatives -->`, or `asitis-disable-file` for the whole file. The reason after `--` is optional; when you give one it is carried into the JSON and SARIF output. The rule id is the word after the severity in each finding, and [`docs/rules/`](https://github.com/Katta041/asitis-agent-tools/blob/main/docs/rules/README.md) lists them all. Security rules (hidden instructions, invisible characters, the `sec-*` rules) cannot be silenced by a comment, since a comment is exactly what an attacker would add; turn them off in `.asitisrc.json` or a baseline, where it shows in review. For an existing repo, `asitis lint --format json --write-baseline > .asitis-baseline.json` and then `--baseline .asitis-baseline.json` reports only new findings.

Every rule has a page with examples: [`docs/rules/`](https://github.com/Katta041/asitis-agent-tools/blob/main/docs/rules/README.md).

## Tools

| Tool | What it returns |
|---|---|
| `read_markdown` | The file text exactly as stored, plus a byte profile: encoding, BOM, CRLF/LF/CR counts, final newline, trailing whitespace, invalid UTF-8 byte ranges, sha256. Pages large files (`offset_bytes`, `max_bytes`, 256 KB default, 1 MB max). `as: "base64"` returns the exact bytes. Marks the content as untrusted and summarises hidden characters and comments. |
| `outline` | ATX and setext headings with line numbers, skipping frontmatter and fenced code. |
| `lint_steering` | Frontmatter on line 1 and valid YAML; required `name` and `description` for SKILL.md and subagents; unknown keys; length against vendor limits; broken relative links and `@path` imports; zero-width, bidi and other invisible characters; hidden HTML comments that read like instructions; text hidden with inline styles; duplicate and contradictory-looking rules; across files, an AGENTS.md that Claude Code never reads, mirrored files that drift apart, and Codex's shared 32 KiB budget. With no path, lints every steering file in the folder. Applies `.asitisrc.json` and suppression comments. `include: ["skills"]` also scans the scripts in skill folders, and `include: ["config"]` audits `.claude/settings.json` and MCP config files. |
| `context_budget` | Approximate tokens per file and per tool for what loads every session: Claude Code (CLAUDE.md plus `@imports` up to 4 hops, or AGENTS.md when there is no CLAUDE.md; rules without `paths`; MEMORY.md first 200 lines when you add your memory folder as a second root; the skill and subagent listing), Codex (root AGENTS.md, first 32 KiB), Gemini CLI (GEMINI.md plus imports up to 5 levels), Cursor always-applied rules, Copilot repository instructions, Windsurf and Cline rules. Long lists are cut; totals still count every file. |
| `find_steering_files` | Every steering file, grouped by when it loads: every session, on match (`paths`, `globs`, `applyTo`), on invocation (skills, commands, agents, prompts), on demand (nested instruction files), memory. |
| `suggest_fixes` | Fixes for mechanical findings (invisible characters, frontmatter not on line 1, skill name fields, trailing whitespace, a missing final newline, instruction-like HTML comments) as a unified diff, plus the old and new text for each edit. Each fix is marked safe or review. It never writes; your assistant applies the edits you accept. |

Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`. Tool results carry no link to asitis.app unless you ask for one: with `--footer` (or `ASITIS_MCP_FOOTER=1`) the first result of each session ends with one line, `Edit these files without rewriting them: https://asitis.app/?ref=mcp`, and later results and errors do not repeat it. `--no-footer` is still accepted and changes nothing. Results are text only. Pass `--structured` (or set `ASITIS_MCP_STRUCTURED=1`) to also get each result as JSON in `structuredContent`, for scripts. It is off by default because Claude Code 2.1 gives the model the JSON instead of the text when both are present, which drops the untrusted-content notice and, for `read_markdown`, the file text.

Vendor limits checked, with sources in [`src/limits.ts`](https://github.com/Katta041/asitis-agent-tools/blob/main/packages/mcp/src/limits.ts):

| File | Limit |
|---|---|
| CLAUDE.md | target under 200 lines (Claude Code memory docs) |
| SKILL.md | under 500 lines; `description` plus `when_to_use` truncated at 1,536 characters in the listing (Claude Code skills docs); `name` up to 64 and `description` up to 1,024 characters (Agent Skills spec; the Claude API and claude.ai reject longer ones, while Claude Code loads them and truncates the listing) |
| MEMORY.md | first 200 lines or 25 KB load (Claude Code memory docs) |
| AGENTS.md | 32 KiB combined across the AGENTS.md files Codex loads, root first (`project_doc_max_bytes`) |
| Cursor rules | under 500 lines |
| Windsurf rules | 12,000 characters per workspace rule file (6,000 for `global_rules.md`) |

## Privacy

- The server and the CLI make no network connections and have no network code. They collect nothing and send nothing.
- They never write, rename or delete a file, and create no temp files. Fixes come back as a diff; applying one is up to you or your assistant.
- By default only markdown steering files, `.asitisrc.json` and, when a relative link is missing, the root `.gitmodules` (to tell a submodule that is not checked out from a broken link) are read. Skill scripts are read only when you pass `include: ["skills"]` (or `--include skills`), and `.claude/settings.json`, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` and `.gemini/settings.json` only with `include: ["config"]`, which also reads the `name`, `homepage` and `repository` of the root `package.json` and `pyproject.toml` so the project's own MCP server and install script are recognised. `.claude/settings.local.json` needs `config-local`. `~/.claude.json` is never read. Values from settings files are never echoed: findings name the key, and anything shaped like a secret is redacted.
- It logs one start-up line to stderr (version and root folder), never file content.
- **What your assistant does with results is up to your assistant.** Tool results go into the model's context, so they reach whichever AI provider your assistant uses. That is your assistant's network traffic, not ours.

## Security model

- **Root confinement.** Every path is resolved with `realpath` and must stay inside a root given at start-up. `../` traversal, absolute paths outside the root and symlinks (file or folder) that resolve outside are refused. Symlinks that resolve inside a root are followed, so a CLAUDE.md that links to AGENTS.md or a linked `.claude/skills` folder is checked where the agent sees it. The filesystem root and your home folder are refused as roots unless you pass `--allow-broad-root`.
- **Markdown only, unless you opt in.** By default only `.md`, `.mdc`, `.markdown`, `.mdx`, `.cursorrules`, `.windsurfrules` and `.clinerules` are read, plus `.asitisrc.json` (at most 64 KB). `include: ["skills"]` adds the scripts inside skill folders (up to 1 MB each; other files there are read for their first 4 bytes only, to spot binaries), and `include: ["config"]` adds the agent settings and MCP config files listed under Privacy. `.env*`, anything in `.git/` or `node_modules/`, `~/.claude.json` and every other file are always refused, including through a symlink that points at them. A repo's `.asitisrc.json` cannot turn these scans on in the MCP server; only the call (or the CLI flag) can. `@imports` of other files are counted from their size, never read. Nothing that is read is ever run.
- **Bounded work.** Files over 16 MB are refused (`--max-file-mb`), results are capped, every tool call has a 20 s budget, and every scanner is linear time. The test suite runs 32 adversarial 10 MB inputs (unclosed comments, bracket and backtick storms, 2,000-character import tokens, invalid UTF-8 and more) through every tool under a 3 s per-call budget.
- **Untrusted content.** `read_markdown` labels file content as data, not instructions, and reports hidden instructions and invisible characters up front. This does not stop a model from obeying text it reads; it makes the text visible.
- **Stronger sandbox, optional.** Run the server under Node's permission model so the runtime itself forbids writes and child processes (and network access on Node 25 and later). The Hardened setup under Install shows how; the Claude Code plugin does this by default.

## Known limits

- Token counts are local approximations (about 4 characters per token for English), not any vendor's tokenizer.
- A hardlink inside the root to a file elsewhere is read like any other file (reads only).
- A symlink swapped into a parent folder between the check and the open is a narrow race; the final path component is opened with `O_NOFOLLOW` and checked by inode.
- On Windows, junctions, case-folded paths, 8.3 short names, `\\?\` and `\\.\` device prefixes, UNC paths and trailing dots or spaces are judged on the real path and tested. Alternate data streams (`notes.md:stream`) and reserved device names (`CON`, `NUL.md`) are refused outright.

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

## Package

The package is two files, the server `dist/asitis-mcp.mjs` and the CLI `dist/asitis.mjs` (built with esbuild, minified), with zero runtime dependencies and no install scripts. The MCP SDK (pinned to 1.31.0), zod and yaml are bundled in; their licences are in `dist/THIRD_PARTY_NOTICES.md`. The release workflow in this repository (`.github/workflows/release.yml`) publishes with npm provenance, so a version it publishes shows a provenance attestation on npmjs.com and can be checked with `npm audit signatures`. Versions up to 0.2.4 were published by hand, without provenance.

## License

[MIT](https://github.com/Katta041/asitis-agent-tools/blob/main/LICENSE). Changes are listed in the [changelog](https://github.com/Katta041/asitis-agent-tools/blob/main/packages/mcp/CHANGELOG.md). Report vulnerabilities privately through [GitHub security advisories](https://github.com/Katta041/asitis-agent-tools/security/advisories/new).

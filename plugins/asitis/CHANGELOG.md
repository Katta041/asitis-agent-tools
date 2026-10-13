# Changelog

All notable changes to the AsItIs Claude Code plugin are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses [Semantic Versioning](https://semver.org/).

## [0.2.2] - 2026-10-14

### Fixed
- The guard hook's own time budget is 6 s instead of 7 s and now counts from the moment the hook process starts. Node start-up and the work the budget cannot interrupt (reading and decoding a file of up to 16 MB) used to fall outside it, so on a slow machine the check could run into Claude Code's 10 s hook timeout, which lets the change through. The guard now always answers first: it asks, or blocks in `deny` mode.
- The guard's fail-closed test is deterministic: it lowers the budget through `ASITIS_GUARD_BUDGET_MS` (which can only lower it) instead of measuring wall-clock time.

### Changed
- The bundled server is `@asitis/mcp` 0.2.2, which adds MCP Registry metadata and no behaviour changes.

## [0.2.1] - 2026-10-13

### Fixed
- Installing the plugin no longer prints "2 userConfig options not yet set". Claude Code reports every plugin option the user has not saved, even one with a default, so the plugin now declares none and reads environment variables instead: `ASITIS_GUARD_MODE` (`ask`, `deny` or `off`) for the guard and `ASITIS_MCP_FOOTER=0` to hide the footer. Set them in the `env` block of your Claude Code settings. If you set `guard_mode` or `footer` with `/plugin configure`, set the variable instead.
- The guard's trailing-whitespace check names the exact lines it would strip, and aligns the old and new text line by line first. Of two identical lines, only the one that loses its trailing spaces is reported, and deleting a line whose twin stays elsewhere is no longer reported as stripping. ([#4](https://github.com/Katta041/asitis-agent-tools/issues/4))
- `lint_steering` no longer reports a hidden instruction for a comment that only names a product, such as Claude Code, or has "claude" in a URL. ([#2](https://github.com/Katta041/asitis-agent-tools/issues/2))
- `lint_steering` compares whole list items and sentences for duplicate rules and skips markup-only lines such as `</details>`, so wrapped lines and closing tags are no longer reported as duplicates. ([#3](https://github.com/Katta041/asitis-agent-tools/issues/3))

### Changed
- The bundled server is `@asitis/mcp` 0.2.1.

## [0.2.0] - 2026-10-03

### Fixed
- The MCP server now starts when the plugin folder is inside the project folder (the "try it with `--plugin-dir`" layout and contributors working in the repository) and when a session starts in the home folder. Node's permission model denied the outer folder when a folder inside it was also allowed; the new launcher drops the redundant nested grant, and `.mcp.json` lists the project folder first.
- A root folder that Node will not let the server read is no longer reported as "Root folder not found". The message names the folders involved and how to fix the flags.
- `outline` finds the first heading of files that start with a BOM (UTF-8 and UTF-16).
- YAML errors in frontmatter are reported on the line where they are, not always on line 2.
- `context_budget` counts only the skills, commands and subagents Claude Code loads every session (`.claude/skills/`, `.claude/commands/`, `.claude/agents/`). Nested `.claude/skills/` folders and other `SKILL.md` files are listed as not loaded.
- The guard hook simulates `Edit` and `MultiEdit` the way Claude Code writes them (one line-ending style for the whole file), so an edit that rewrites the line endings of a mixed-EOL file is caught.

### Security
- `lint_steering`, `outline`, `find_steering_files` and `context_budget` quote and escape YAML keys, values, headings, link targets and file names, and say that quoted text comes from the files. A repository can no longer forge report lines with line breaks, bidi or zero-width characters. File names with such characters get an `unsafe-path` warning.
- Hidden-content checks also catch the `[//]: # (...)` comment idiom and the HTML `hidden` attribute.
- The guard hook fails closed on its own time budget (7 s, inside Claude Code's 10 s hook timeout) and on files over 16 MB: it asks, or blocks in `deny` mode, instead of letting the change through unchecked.
- An unknown `guard_mode` is treated as `deny` and the guard says so.

### Added
- Lint rules from the Agent Skills spec and the Claude API skill rules: reserved words "anthropic" and "claude" in a skill name, XML tags in a name or description, and a warning for a SKILL.md body over about 5,000 tokens. A description over 1,024 characters is now an error.
- On Node older than 22.13 the plugin prints one line, "AsItIs needs Node 22.13 or later; you have X", instead of Node's "bad option: --permission".

### Changed
- Less lint noise: repeated bold labels and short list items under different headings are not duplicate rules; an HTML comment inside inline code is not hidden; `@scope/package` names are not broken imports in AGENTS.md and only a note in CLAUDE.md.
- The plugin is shown as "AsItIs" in the Claude Code plugin list.

## [0.1.0] - 2026-10-01

### Added
- Plugin manifest, listed in the repository's marketplace (`claude plugin marketplace add Katta041/asitis-agent-tools`, then `claude plugin install asitis@asitis`).
- The `@asitis/mcp` 0.1.0 server, vendored and pinned by SHA-256, started under Node's permission model with read access to the plugin and project only.
- `markdown-byte-clean` skill: minimal edits, no whole-file rewrites, frontmatter, line endings, BOM and trailing spaces kept.
- `/asitis:md-lint` and `/asitis:md-budget` commands.
- Optional PreToolUse accident guard for Write, Edit and MultiEdit, with `ask`, `deny` and `off` modes. It fails closed on malformed input and is documented as an accident guard, not a security boundary.

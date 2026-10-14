# Changelog

All notable changes to this repository are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the projects use [Semantic Versioning](https://semver.org/). Per-part detail: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md).

## [Unreleased]

### Changed
- npm and MCP Registry listings link to https://asitis.app/claude-code instead of the home page.
- A test fails the release if a README pins `@asitis/mcp` at any version other than the package's own.
- Tool output: findings sorted errors first with a clear `line N [severity]` prefix, readable outlines, correct plurals and number formatting, tools named and sorted in `context_budget`, and the asitis.app line once per session instead of on every result. Lint messages say how to fix each finding.
- `/asitis:md-lint` and `/asitis:md-budget` ask for a short report with hidden-content findings first; the guard hook's messages use correct plurals and explain why an Edit on a mixed-line-ending file is flagged.
- Docs: npx configs for every MCP client, update and uninstall steps for the plugin, absolute links in the npm and plugin READMEs, a 0.2.0 changelog entry and changelog compare links.

## [0.2.3] - 2026-10-14

### Fixed
- Windows: every file read failed with "is a symlink that resolves outside the allowed folder" when the root folder was given as an 8.3 short path (such as `C:\Users\RUNNER~1\...`, which is what the temp folder looks like on GitHub's Windows runners) or in a different case. Since 0.2.0 the root was resolved with the JavaScript `realpath`, which keeps the path as given, while files were resolved with the native one, which returns long names in their on-disk case, so the two never matched. The root is now also resolved natively and containment is checked against that form, while every file is still opened under the root as given, which is what Node's permission model grants. CI on Windows is green again. The same mismatch affected a case-varied root on macOS.
- Tests: the copy-rules scan skips binary media such as the demo GIF, which is not authored text.
- Tests: the nested-grant message test accepts Windows path separators.

### Added
- Tests for a root given as an 8.3 short path and as a case-varied path, in process and under Node's permission model: paths inside work, links that stay inside work, links and absolute paths outside are refused, and `.env` and `.claude/settings.json` stay refused.
- README: a "Try it in 30 seconds" section and a demo of the browser checker (`docs/checker-demo.gif`).

### Changed
- `@asitis/mcp` npm metadata: a shorter description that names the files it checks, and keywords for the tools people search by (claude-code, claude-md, agents-md, skill-md, mcp-server, prompt-injection, cursor-rules and others).

## [0.2.2] - 2026-10-14

### Added
- Official MCP Registry metadata for `@asitis/mcp`: `mcpName` (`io.github.Katta041/asitis-mcp`) in `packages/mcp/package.json` and `packages/mcp/server.json` (npm package, stdio transport, the `--root` argument).

### Fixed
- Guard hook: its own time budget is 6 s instead of 7 s and counts from process start, so it always answers before Claude Code's 10 s hook timeout, even on a slow machine.
- Tests: the guard's fail-closed test lowers the budget through `ASITIS_GUARD_BUDGET_MS` instead of measuring wall-clock time, and the copy-rules test scans only git-tracked files, so a local `npm pack` tarball is never reported.

## [0.2.1] - 2026-10-13

### Fixed
- `lint_steering`: `hidden-instruction` no longer fires on a product name alone, such as a comment that mentions Claude Code or a URL that contains "claude". Fixes [#2](https://github.com/Katta041/asitis-agent-tools/issues/2).
- `lint_steering`: `duplicate-rule` compares whole list items and sentences and skips markup-only lines such as `</details>`, so wrapped lines and closing tags are no longer duplicates. Fixes [#3](https://github.com/Katta041/asitis-agent-tools/issues/3).
- Guard hook: the trailing-whitespace check names the exact lines, and of two identical lines reports only the one that loses its trailing spaces. Fixes [#4](https://github.com/Katta041/asitis-agent-tools/issues/4).
- `claude plugin install asitis@asitis` no longer prints "2 userConfig options not yet set". The guard mode and the footer are now set with `ASITIS_GUARD_MODE` and `ASITIS_MCP_FOOTER` in the `env` block of Claude Code settings.

## [0.2.0] - 2026-10-03

### Fixed
- The plugin's MCP server starts when the plugin folder is inside the project folder (the `--plugin-dir` layout) and when a session starts in the home folder. A root that Node's permission model will not let the server read gets a one-line explanation instead of "Root folder not found".
- `outline` keeps the first heading of files that start with a BOM, and YAML errors are reported on their real line.
- `context_budget` counts only the skills, commands and subagents Claude Code loads from `.claude/`.
- Guard hook: `Edit` and `MultiEdit` are simulated the way Claude Code writes them, so an edit that rewrites the line endings of a mixed-EOL file is caught.

### Security
- Every tool quotes and escapes text taken from files and marks it as untrusted, so a repository cannot forge report lines. New `unsafe-path` warning.
- `[//]: # (...)` comments and the HTML `hidden` attribute are reported as hidden content.
- The guard hook fails closed on its own time budget and on files over 16 MB, and treats an unknown mode as `deny`.

### Added
- Lint rules `name-reserved-word`, `xml-tag` and `body-tokens`; `description-too-long` is now an error.
- On Node older than 22.13 the plugin prints one clear line instead of Node's "bad option: --permission".

### Changed
- Fewer false positives: bold labels and short list items in other sections, comments in inline code, npm package names after `@`.
- The plugin is shown as "AsItIs" in the Claude Code plugin list.

## [0.1.0] - 2026-10-01

### Added
- `@asitis/mcp` 0.1.0: stdio MCP server with five read-only tools (`read_markdown`, `outline`, `lint_steering`, `context_budget`, `find_steering_files`), root confinement, a markdown-only allowlist, size caps, a per-call time budget and linear-time scanners.
- Claude Code plugin `asitis` 0.1.0: the server vendored and pinned by SHA-256 and started under Node's permission model, the `markdown-byte-clean` skill, `/asitis:md-lint`, `/asitis:md-budget` and an optional accident guard hook.
- Repository-level Claude Code marketplace (`.claude-plugin/marketplace.json`).
- CI on Ubuntu, macOS and Windows, and a manual release workflow for npm trusted publishing with provenance.
- MIT licence.

[Unreleased]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Katta041/asitis-agent-tools/compare/12b43a6...v0.2.0
[0.1.0]: https://github.com/Katta041/asitis-agent-tools/commit/12b43a6

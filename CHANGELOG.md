# Changelog

All notable changes to this repository are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the projects use [Semantic Versioning](https://semver.org/). Per-part detail: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md).

## [Unreleased]

### Changed
- `@asitis/mcp` npm metadata: a shorter description that names the files it checks, and keywords for the tools people search by (claude-code, claude-md, agents-md, skill-md, mcp-server, prompt-injection, cursor-rules and others). Ships in 0.2.3; the published 0.2.2 is unchanged.

### Added
- README: a "Try it in 30 seconds" section and a demo of the browser checker (`docs/checker-demo.gif`).

### Fixed
- Tests: the copy-rules scan skips binary media such as the demo GIF, which is not authored text.

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

## [0.1.0] - Unreleased

### Added
- `@asitis/mcp` 0.1.0: stdio MCP server with five read-only tools (`read_markdown`, `outline`, `lint_steering`, `context_budget`, `find_steering_files`), root confinement, a markdown-only allowlist, size caps, a per-call time budget and linear-time scanners.
- Claude Code plugin `asitis` 0.1.0: the server vendored and pinned by SHA-256 and started under Node's permission model, the `markdown-byte-clean` skill, `/asitis:md-lint`, `/asitis:md-budget` and an optional accident guard hook.
- Repository-level Claude Code marketplace (`.claude-plugin/marketplace.json`).
- CI on Ubuntu, macOS and Windows, and a manual release workflow for npm trusted publishing with provenance.
- MIT licence.

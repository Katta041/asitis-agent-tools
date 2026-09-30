# Changelog

All notable changes to this repository are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the projects use [Semantic Versioning](https://semver.org/). Per-part detail: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md).

## [0.1.0] - Unreleased

### Added
- `@asitis/mcp` 0.1.0: stdio MCP server with five read-only tools (`read_markdown`, `outline`, `lint_steering`, `context_budget`, `find_steering_files`), root confinement, a markdown-only allowlist, size caps, a per-call time budget and linear-time scanners.
- Claude Code plugin `asitis` 0.1.0: the server vendored and pinned by SHA-256 and started under Node's permission model, the `markdown-byte-clean` skill, `/asitis:md-lint`, `/asitis:md-budget` and an optional accident guard hook.
- Repository-level Claude Code marketplace (`.claude-plugin/marketplace.json`).
- CI on Ubuntu, macOS and Windows, and a manual release workflow for npm trusted publishing with provenance.
- MIT licence.

# Changelog

All notable changes to the AsItIs Claude Code plugin are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added
- Plugin manifest, listed in the repository's marketplace (`claude plugin marketplace add Katta041/asitis-agent-tools`, then `claude plugin install asitis@asitis`).
- The `@asitis/mcp` 0.1.0 server, vendored and pinned by SHA-256, started under Node's permission model with read access to the plugin and project only.
- `markdown-byte-clean` skill: minimal edits, no whole-file rewrites, frontmatter, line endings, BOM and trailing spaces kept.
- `/asitis:md-lint` and `/asitis:md-budget` commands.
- Optional PreToolUse accident guard for Write, Edit and MultiEdit, with `ask`, `deny` and `off` modes. It fails closed on malformed input and is documented as an accident guard, not a security boundary.

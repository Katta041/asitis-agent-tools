# Changelog

All notable changes to `@asitis/mcp` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added
- Stdio MCP server with five read-only tools: `read_markdown` (byte-faithful text plus encoding, BOM, line-ending, trailing-whitespace and invalid UTF-8 profile, paging, base64 mode), `outline`, `lint_steering`, `context_budget` and `find_steering_files`.
- Steering-file lint: frontmatter line-1 rule and YAML parse, required SKILL.md and subagent fields, unknown keys, vendor length limits, broken relative links and `@imports`, invisible and bidirectional characters, hidden instruction comments, hidden styled text, duplicate and contradictory-looking rules, orphaned memory files.
- Root confinement with realpath checks, markdown-only allowlist, hard deny for `.env*`, `.claude/settings*.json`, `.git/` and `node_modules/`, size caps, per-call time budget and linear-time scanners.
- One-file bundle with zero runtime dependencies and third-party notices.
- One footer line per result pointing to asitis.app, with `--no-footer` to turn it off.
- Released under the MIT licence.

### Security
- Regression tests for path traversal, symlink file and folder escape, settings and `.env` access, and 10 MB denial-of-service inputs.
- There is no write, patch or delete tool.

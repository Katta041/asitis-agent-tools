# Changelog

All notable changes to `@asitis/mcp` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-03

### Fixed
- The server starts when Node's permission model denies `realpath` on the root (it falls back to the lexical path), and a root that Node will not let it read gets a one-line explanation naming the nested `--allow-fs-read` folder, instead of "Root folder not found" or a raw Node error. Root checks use the sync fs API, which fails cleanly on Node 22.13.
- `outline` keeps the first heading of files with a BOM. YAML errors are reported on their real line.
- `context_budget` counts only skills, commands and subagents that Claude Code loads from `.claude/`.

### Security
- Every tool quotes and escapes text from files (keys, values, headings, link targets, file names, error messages) and marks it as untrusted, so a repository cannot forge report lines. New `unsafe-path` warning.
- `[//]: # (...)` comments and the HTML `hidden` attribute are reported as hidden content.

### Added
- Lint: `name-reserved-word`, `xml-tag` and `body-tokens`; `description-too-long` is now an error.

### Changed
- Fewer false positives: bold labels and short list items in other sections, comments in inline code, npm package names after `@`.

## [0.1.0] - 2026-10-01

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

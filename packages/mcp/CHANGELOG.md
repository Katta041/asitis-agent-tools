# Changelog

All notable changes to `@asitis/mcp` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses [Semantic Versioning](https://semver.org/).

## [0.2.3] - 2026-10-14

### Fixed
- Windows: reads no longer fail with "is a symlink that resolves outside the allowed folder" when the root is given as an 8.3 short path (`C:\Users\RUNNER~1\...`) or in a different case. Since 0.2.0 the root was resolved with the JavaScript `fs.realpathSync`, which keeps the spelling it is given, while files were resolved with the native `fs.promises.realpath`, which returns long names in their on-disk case, so a file inside the root looked outside it. The root is now also resolved with `fs.realpathSync.native`, and containment is checked against that form (case-insensitively on Windows). Paths are still opened under the root as given, because Node's permission model compares `--allow-fs-read` folders as plain, case-sensitive strings and does not expand short names. Confinement is unchanged: links that resolve outside the root, `.env` files and `.claude/settings*.json` are still refused. A case-varied root on macOS had the same problem.
- An absolute path to a file inside the root is accepted in any of the root's spellings (as given, in another case, or the long form) and is opened under the root as given.

### Changed
- npm `description` and `keywords` rewritten for search: the description names the files checked (CLAUDE.md, AGENTS.md, SKILL.md, Cursor rules) and stays under 160 characters; 20 keywords.

### Tests
- New `root-forms` tests run every confinement check with the root given as an 8.3 short path (from `cmd`'s `%~s`) and as a case-varied path, in process and under `--permission` with only that form granted.

## [0.2.2] - 2026-10-14

### Added
- Official MCP Registry metadata: `mcpName` (`io.github.Katta041/asitis-mcp`) in `package.json` and a `server.json` that describes the npm package, its stdio transport and the `--root` argument. No change to the server itself.

### Fixed
- The guard hook test that checks the fail-closed time budget no longer depends on machine speed. It lowers the budget through `ASITIS_GUARD_BUDGET_MS` instead of timing a large MultiEdit against the clock.
- The copy-rules test scans only files tracked by git, so a local `npm pack` tarball or build output is never reported as authored copy.

## [0.2.1] - 2026-10-13

### Fixed
- `hidden-instruction` no longer fires on a product name alone, such as a comment saying a file was made with Claude Code, or "claude" inside a URL. A comment must speak to the assistant: by name followed by a comma or colon ("Claude, ..."), with the name as the subject of a directive ("Copilot should ..."), or with the existing cues ("ignore previous instructions", "you must", "note to the AI:"). URLs are ignored when classifying. ([#2](https://github.com/Katta041/asitis-agent-tools/issues/2))
- `duplicate-rule` compares whole list items and whole sentences, with wrapped lines joined first, instead of single lines. Markup-only lines such as `</details>`, short labels such as "Code comments:", and short emphasis sentences such as "No exceptions." are not rules. On a sample of 200 public CLAUDE.md and AGENTS.md files this removes all 5 noisy findings and keeps the 4 real duplicates. ([#3](https://github.com/Katta041/asitis-agent-tools/issues/3))

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

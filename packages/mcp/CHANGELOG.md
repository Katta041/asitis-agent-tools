# Changelog

All notable changes to `@asitis/mcp` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses [Semantic Versioning](https://semver.org/).

## [0.2.5] - 2026-10-14

### Changed
- Results are text only by default. Claude Code 2.1 gives the model `structuredContent` instead of the text when both are present, which dropped the untrusted-content notice, the escaping and `read_markdown`'s file text, and made results two to five times larger. `--structured` or `ASITIS_MCP_STRUCTURED=1` adds the JSON back for scripts.
- The asitis.app line is off by default. `--footer` (or `--footer true`) or `ASITIS_MCP_FOOTER=1` turns it on, once per session as before. `--no-footer` and `--footer false` are still accepted and win over the variable.
- `context_budget`, Claude Code: with a CLAUDE.md, AGENTS.md counts only when CLAUDE.md `@`-imports it, and a note says "Claude Code ignores AGENTS.md here" when it does not; with no CLAUDE.md, AGENTS.md and its imports are counted (Claude Code 2.1.277 and later; checked with canary files on 2.1.299). Lint checks AGENTS.md imports in that second case only.
- `context_budget`: nested `.windsurfrules` and nested always-apply Cursor rules are on demand, not every session; Cline rules with `paths` load on match, `paths: []` never, and `.clinerules/workflows/*.md` on invocation; `.claude/CLAUDE.local.md` is not a location Claude Code reads; MEMORY.md counts for Claude Code only from a memory folder (a second `--root`, or `.claude/projects/<project>/memory/`); Gemini CLI imports are followed 5 levels deep; nested skills and nested commands or subagents get separate, accurate notes; an unclosed comment no longer hides the rest of CLAUDE.md from the count. The CLAUDE.md entry says why the whole file is larger (block comments are stripped), and a missing `@import` prints a warning with the importing file and line.
- Symlinks that resolve inside a root are followed by the folder walk, each real folder once. A file reached through one is classified by the path the agent sees and shown as `CLAUDE.md (symlink to AGENTS.md)`.
- Result sizes: `read_markdown` returns 32 KiB by default (about 8k tokens); `outline` lists 400 headings per call and takes `offset`; `find_steering_files` and `context_budget` list at most 60 files per group and give the full counts; `lint_steering` lists at most 300 findings, says "Linted 300 of 1,602 steering files found" with how to lint the rest, and says when the walk stopped for depth, size or time. More than 200 imports are named as "At least N more imports", not counted, and flagged.
- Cursor rule types use Cursor's current names (Always Apply, Apply to Specific Files, Apply Intelligently, Apply Manually).

### Fixed
- `duplicate-rule`: a short list item repeated under another heading or parent bullet is reported when it reads as an instruction: it starts with a verb such as use, run, keep, add or avoid, says always, never, don't, must or should, or holds a command in backticks (`pnpm test`). Labels such as "Quality checklist", "Commit messages", "**Commands**" or "Run the tests:" are still skipped, and so is the same item under two different parent bullets (a per-parent checklist). Lines up to 2,000 characters are compared (was 400), a leading "a", "an" or "the" is ignored, and copies under different headings say they may be deliberate alternatives.
- `contradiction`: "Use X" against "Never use X" or "Don't use X", "Always X" against "Never X", "Do X" against "Do not X", "must" against "must not" and "Prefer X" against "Avoid X" are matched after ignoring case, backticks, emphasis and punctuation, anywhere in the file. The finding is on the later line and quotes both: `Contradicts line 10: line 10 says "Use named exports" and line 11 says "Never use named exports"`. An item under a heading, parent bullet or lead-in about things to avoid (Don'ts, Avoid, Anti-patterns, Bad, Pitfalls) is not read as a "do" rule.
- `broken-link`: `#anchor` links are checked against the headings of the file (GitHub slugs, repeated headings, `{#id}` and HTML `id`/`name`), also in other markdown files. Placeholders such as `[Title](URL)` and `${GITHUB_SERVER_URL}/...` are skipped.
- Encodings: `invalid-utf8` is reported on the line with the bad byte and suggests Latin-1 or Windows-1252; UTF-16 without a BOM is recognised; UTF-16 files no longer get a "may be a binary file" warning.
- `frontmatter-yaml`: Cursor's unquoted `globs: *.ts,*.tsx` is accepted in `.mdc` rules, so the rule also loads on match instead of manual-only. The message names the tool that reads the file and no longer claims a specific Claude Code behaviour.
- `hidden-instruction`: a secret word alone ("token", "SSH") or "Important:" or "Rule:" no longer makes a maintainer note an instruction; a request to send, print or upload secrets or `.env` does. "Agent:", "AI,", "Bot,", "Assistant must", "Model note" and more assistant names (Kiro, Windsurf, Cline, Aider, Devin, Junie) count as addressing the AI, and "ignore previous instructions" is recognised in Spanish, German, French, Chinese and Japanese.
- `hidden-styled-text`: `display:none` inside inline code is not flagged; a `hidden` attribute on the second line of a tag is.
- `invisible-char`: a ZERO WIDTH JOINER inside an emoji sequence is not flagged; runs of variation selectors, or one after an ordinary character (U+E0100 block), are.
- `broken-import`: an `@name` inside an HTML comment is not an import (Claude Code strips those comments).
- `hidden-comment`: the note points at the first plain comment, including a `[//]: #` comment.
- `duplicate-across-files`: only files that the same tool loads in the same session are compared (CLAUDE.md, its imports and always-on rules for Claude Code; always-apply Cursor rules; and so on), and the message names that tool.
- Vendor docs, rechecked on 2026-10-14: skill booleans accept `yes`, `no`, `on`, `off`, `1` and `0`; `description` on `.claude/rules`, `name` and `paths` on commands, and `version` on skills are reported as ignored; a memory file without a description is a note, not a warning; the missing-description message says Claude Code uses the first non-empty line; a skill name with non-ASCII lowercase letters is a warning (the spec allows it, the Claude API does not); `missing-applyTo` fires only when `description` is missing too; the Codex length advice says the 32 KiB is shared by every AGENTS.md and no longer suggests nested files.
- New: `frontmatter-value-cut` warns when an unquoted ` #` cuts a value short (`description: Use for A #1 and B`), and `unknown-key` is a warning with a suggestion when the key is one or two letters from a known key (`user-invokable`: did you mean `user-invocable`?).
- Protocol: bad JSON gets a -32700 response, a batch or a malformed request -32600, an unknown tool or wrong parameters -32602 with a one-line message. A message over the 10 MB read buffer ends the session with one line on stderr and exit code 1. Filesystem errors say "Permission denied" or "Symlink loop", and internal errors have absolute paths removed. At most 4 tool calls run at once and 32 wait; more get a "Busy" result.
- Folder walk: a `.claude/projects/<project>/memory` fixture replaces the old top-level `memory/` in the tests, and a `memory` folder deep in a source tree (for example `src/lib/memory/README.md`) is no longer treated as Claude memory.

On the pinned sample of 200 public AGENTS.md and CLAUDE.md files, `duplicate-rule` goes from 4 to 5 findings (the new one is a real repeat in strapi/strapi), `contradiction` stays at 0, and `broken-import` gains 4 findings in one AGENTS.md (it has no CLAUDE.md beside it in the sample, so its `@path` imports are now checked, and the linked files were not part of the sample). No other rule changes.

## [0.2.4] - 2026-10-14

### Changed
- npm and MCP Registry listings link to https://asitis.app/claude-code instead of the home page.
- A test fails the release if a README pins `@asitis/mcp` at any version other than the package's own.
- Tool output is easier to read for people and models. Findings read `- line 12 [warning] rule: message`, sorted errors first; files with errors come first and clean files share one closing line. `outline` prints `line 7: # "Title"`, indented by level, instead of `L7  # "Title"`, which lost its spacing when copied. Plurals are correct ("1 file", not "1 file(s)"), numbers have thousands separators, and "about 10.0k tokens" is now "about 10k tokens".
- `context_budget` lists tools by name (Claude Code, Codex, Gemini CLI) and largest first, opens with a one-line total per tool, and says why an import was not counted instead of "about 0 tokens".
- `find_steering_files` says a note shared by every skill once instead of on each line, and ends with what to run next.
- `read_markdown` describes the file in one sentence ("File: 32 bytes, 3 lines, UTF-8, LF line endings, final newline, no trailing whitespace.") instead of a row of `|` fields.
- Lint messages say what to do: fix or remove a broken link or import, keep one of two duplicate or contradictory rules (now quoted), delete an invisible character, and a valid skill name to use for `name-format`. `field-type` no longer double-quotes a string value (`not "yes"`, was `not "\"yes\""`).
- The asitis.app line is shown once per session, on the first successful result, and never on an error. The untrusted-data notice is shorter. Errors for a missing file point to `find_steering_files`; size errors read "4,096 bytes" or "17.2 MB".

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

[0.2.5]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Katta041/asitis-agent-tools/compare/12b43a6...v0.2.0
[0.1.0]: https://github.com/Katta041/asitis-agent-tools/commit/12b43a6

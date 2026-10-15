### Added
- `suggest_fixes` returns fixes as a unified diff plus, for each fix, the old and new text to use with Edit. It never writes. `safety: "safe"` limits it to fixes that cannot change what the text says; `rules` limits it to some rule ids.
- Safe fixes for `invisible-char`, `trailing-whitespace`, `final-newline` and `frontmatter-not-line-1`. Review fixes for `bidi-control`, `name-format`, `name-dir-mismatch`, `field-type` (`alwaysApply: "yes"` becomes `true`), `frontmatter-value-cut`, near-miss `unknown-key` and `hidden-instruction`.
- Diffs keep CRLF, mixed line endings, the BOM, trailing whitespace elsewhere and a missing final newline exactly as they are, and `git apply` takes them. Lines with invalid UTF-8 are left out of the context; a fix next to one is not offered.
- `attachFixes` and `fixPreview` in `fix.ts` for the CLI's `--fix-preview` (JSON `fix`, SARIF `fixes[]`, one combined diff for text).
- Two note-level rules: `trailing-whitespace` (spaces or tabs at a line end that change nothing when rendered; possible hard line breaks, code and frontmatter are left alone) and `final-newline` (a file with line breaks that does not end with one).
- `/asitis:md-fix` plugin command: shows the diff, asks, and applies the accepted fixes with Edit.

### Changed
- No fix is offered for invisible characters that carry meaning: a ZWNJ or ZWJ between letters of Persian, Arabic, Hindi and other scripts, a ZWJ next to an emoji, an LRM or RLM on a line with right-to-left text, the tag characters of a flag emoji. A skill name with non-ASCII characters gets no fix either.
- `name-dir-mismatch` fixes are marked review, not safe: in Claude Code `name` sets the slash command, so the rename changes what people type.
- `hidden-comment` is no longer marked fixable. Deleting every plain comment in a file is a judgement call, not a mechanical fix; `hidden-instruction` comments still get a review fix.

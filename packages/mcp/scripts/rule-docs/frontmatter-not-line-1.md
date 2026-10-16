## Catches
A `---` block with `key: value` lines that starts after a blank line, a title or a comment. Claude Code, Cursor, Copilot and the Agent Skills validators all look for `---` on line 1 and nowhere else. The block is still in the file, so it looks fine in an editor, but every tool treats it as body text.

## Bad
```markdown
# Release notes skill

---
name: release-notes
description: Draft release notes from merged PRs. Use when asked for a changelog or release summary.
---

Collect merged PRs since the last tag...
```
The author put a title first. Claude Code lists this skill under its folder name with the first body line as its description, which is the heading, and Codex and Cursor skip it because `name` and `description` are missing.

## Good
```markdown
---
name: release-notes
description: Draft release notes from merged PRs. Use when asked for a changelog or release summary.
---

# Release notes skill

Collect merged PRs since the last tag...
```

## Fix
Delete everything above the opening `---`, including blank lines, and move the title below the closing `---`. If the first line is a `<!-- comment -->`, move it below too.

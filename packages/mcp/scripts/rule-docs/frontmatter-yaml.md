## Catches
Frontmatter that the YAML parser rejects. The message quotes the parser's reason and the line. The usual causes are a colon inside an unquoted value, a tab used for indentation, an unquoted value that starts with `*`, `&`, `@` or `[`, and a stray quote.

## Bad
```markdown
---
name: pr-review
description: Review a pull request. Use when: the user pastes a PR link or asks for a review.
---
```
The second `:` in the description starts a nested mapping as far as YAML is concerned, so the parser stops with "Nested mappings are not allowed in compact mappings". Claude Code loads the skill with no description, and Codex and Cursor skip it.

## Good
```markdown
---
name: pr-review
description: "Review a pull request. Use when: the user pastes a PR link or asks for a review."
---
```

## Fix
Read the parser message in the finding; it names the line. Put values that contain `:`, `#`, quotes or a leading `*`, `&`, `@`, `[` or `{` in double quotes. Replace tabs with spaces. For a long description, use a block scalar:

```yaml
description: >-
  Review a pull request. Use when: the user pastes a PR link
  or asks for a review.
```

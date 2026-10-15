## Catches
A file that loads at the start of every session (a root CLAUDE.md, `.claude/rules/*.md` without `paths`, `.cursorrules`, `.github/copilot-instructions.md` and similar) with more than about 5,000 tokens in it. It is a note, not a warning: the file may be worth it. The point is that the cost is paid in every conversation, including ones that never touch the subject. The message says what to do: move topic-specific parts into files that load only when needed, such as path-scoped `.claude/rules/` files, skills or linked docs.

## Bad
```markdown
# CLAUDE.md

## API reference
<full endpoint-by-endpoint description of the REST API, 6,000 tokens>
```
Every session starts 6,000 tokens shorter, and the docs on which this rule rests say long instruction files are followed less reliably.

## Good
```markdown
# CLAUDE.md

The REST API is described in [docs/api.md](docs/api.md); read it before changing a handler.
```

## Fix
Keep rules in the every-session file and move reference material behind a link, so the agent reads it when it needs it. Path-scoped rules (`.claude/rules/` with `paths`, Cursor `globs`, Copilot `applyTo`) load only for matching files.

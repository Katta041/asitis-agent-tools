## Catches
Lines that end in spaces or tabs that do nothing when the markdown is rendered. Exactly two spaces (a hard line break), lines in code blocks and frontmatter are left alone. The finding points at the first such line and counts the rest. It is a note.

## Bad
```text
Run the tests before you commit.···
Use pnpm, not npm.→
```
(`·` is a space, `→` a tab.) Nobody sees them, and the next editor that trims on save turns a one-line change into a diff of every line that had them.

## Good
```text
Run the tests before you commit.
Use pnpm, not npm.
```

## Fix
Delete the trailing spaces and tabs. `asitis lint --fix-preview=safe` prints a diff that does only that, and `git apply` takes it. Most editors can trim trailing whitespace on save for markdown files.

## Catches
A subfolder `CLAUDE.md`, `AGENTS.md` or `GEMINI.md` that repeats rules from the same kind of file in a folder above it. The agent loads both when it works in the subfolder, so the shared rules cost context twice, and the two copies drift apart the first time someone edits one. Needs at least two shared rules of 24 characters or more. When many subfolders copy the same file, you get one note that lists them.

## Bad
```text
CLAUDE.md                - Run tests with pnpm test before you commit
                         - Never commit generated files under dist/
packages/api/CLAUDE.md   - Run tests with pnpm test before you commit
                         - Never commit generated files under dist/
                         - API handlers live in src/routes/
```

## Good
```text
CLAUDE.md                - Run tests with pnpm test before you commit
                         - Never commit generated files under dist/
packages/api/CLAUDE.md   - API handlers live in src/routes/
```

## Fix
Keep shared rules in the top file and only folder-specific ones in the subfolder file.

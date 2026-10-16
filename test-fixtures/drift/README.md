# Drift fixtures (WP4)

One folder per case for `packages/mcp/test/drift.test.ts`. Each folder is linted as its own root.
Symlink cases and the Codex 32 KiB chain are built in a temp folder by the test, because git on
Windows checks symlinks out as plain files and the chain needs large files.

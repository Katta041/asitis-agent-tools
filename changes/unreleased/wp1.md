### Added
- `asitis` CLI, a second bin in `@asitis/mcp` (`npx -y -p @asitis/mcp asitis lint`). `asitis lint [paths...]` lints the named files, or every steering file under `--root`, and exits 0 (clean), 1 (findings at or above `--fail-on`), 2 (something you can fix, one line on stderr) or 3 (a bug, one line with the issue link). Flags: `--format`, `--fail-on`, `--config`, `--baseline`, `--write-baseline`, `--include`, `--fix-preview[=safe]`, `--max-files`, `--max-file-mb`, `--quiet`, `--allow-broad-root`.
- `asitis budget [file]`: the per-tool token budget that `context_budget` reports, as text or JSON.
- Output formats: `text` (one line per finding, grouped by file, then a summary), `json` (schema in `packages/mcp/schema/report-1.json`), `sarif` (SARIF 2.1.0 with rule metadata, fingerprints, suppressions and fixes) and `github` (workflow-command annotations, escaped so text from a file can never become a command of its own).
- The CLI bundle ships in the plugin (`plugins/asitis/server/asitis.mjs`) and for the GitHub Action (`action/asitis.mjs`), each pinned by SHA-256 in a `VERSION` file and checked in CI.

### Changed
- `plugins/asitis/server/VERSION` has a third line with the CLI's SHA-256. The server pin on line 2 is unchanged.

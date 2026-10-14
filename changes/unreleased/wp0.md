### Added
- `suggest_fixes` MCP tool, registered but not functional yet: it says fixes are not available in this build.
- `lint_steering` accepts `include` (`skills`, `config`, `config-local`). Nothing extra is scanned yet; asking for a scan that is not available ends the result with a one-line notice.
- Rule registry (`src/rules/`) with metadata for the 45 rules the linter emits today, and reserved ids for the 0.3.0 tracks (drift, skill scan, agent config audit, suppression) and for the spec-gap and threat-catalogue backlog.
- `docs/cli-contract.md`: flags, exit codes, JSON schema and SARIF and GitHub output for the `asitis` CLI.

### Changed
- Project-level linting moved from `server.ts` to `project.ts` (`lintProject`). Output of every existing tool is byte-identical to 0.2.5 on all test fixtures.

### Fixed
- A file whose lint threw an error after it was read could leave cross-file checks matching findings to the wrong file. Files are now added to the cross-file set only after they lint.

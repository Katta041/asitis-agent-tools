### Added

- `.asitisrc.json` config at the project root (or `--config <file>` inside it). Per-rule severity (`error`, `warning`, `note`, `off`), `length` thresholds (`claudeMdLines`, `skillMdLines`, `cursorRuleLines`, `codexBytes`, `windsurfChars`, `memoryIndexLines`), `ignore` and `overrides` globs, `include`, and `extends: "recommended" | "strict"`. `strict` raises notes to warnings and, in the CLI, turns on the `skills` and `config` scans, where the `sec-*` rules live. JSON schema at `packages/mcp/schema/asitisrc-1.json`.
- Every config mistake stops the run with the file, the line and a suggestion, for example `.asitisrc.json line 2: unknown key "rulez" (did you mean "rules"?)`. Unknown keys, unknown or not-yet-available rule ids, bad severities, bad option types, duplicate keys and invalid JSON are all caught. Values that could be secrets are redacted.
- Inline suppression: `<!-- asitis-disable-next-line rule-id -- reason -->` and `<!-- asitis-disable-file rule-id -- reason -->` (`asitis-disable` works as the file form). A rule id is required. Security rules cannot be suppressed by a comment. New rules `suppression-not-allowed`, `unknown-suppression` and `unused-suppression`.
- Baselines: `--baseline <file>` marks findings whose fingerprint is listed as suppressed. Fingerprints survive lines inserted above and CRLF/LF changes; a new copy of a baselined finding still fires.
- `lint_steering` reads `.asitisrc.json` on every call and applies config and comments the same way the CLI does. Suppressed findings are counted, not listed. A repo's config never widens what the server reads: `include` and `strict` scans in it are ignored there, with a note to pass `include` to `lint_steering` instead. The CLI honours them (`configInclude` in `lintProject`).

### Changed

- An `asitis-disable` comment no longer counts towards the `hidden-comment` note. A directive whose reason reads like an instruction is still reported as `hidden-instruction`.

### Fixed

- Linting a file with many comment lines and no backticks was quadratic (a 10 MB file of one-line comments took over 20 seconds). The inline code span check now looks at one line at a time.

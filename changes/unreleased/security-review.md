### Security

- A repo's own `.asitisrc.json` or baseline can no longer hide a security finding without saying so. `lint_steering` ignores rules turned off, lowered or ignored for security rules unless the call passes `trustRepoConfig: true`. The CLI and the Action still apply the config, but every hidden security finding stays in JSON and SARIF as a suppressed result with a justification, and one line counts them (also with `--quiet`). New CLI flag `--fail-on-hidden-security`; the Action's new input `fail-on-hidden-security` is on by default.
- An `ignore` pattern no longer drops the security findings of a file it matches.
- Redaction now masks credentials by position (URL passwords, `Authorization:` and key headers, `--token`, `key=` and the like), more key shapes (GitLab, Hugging Face, SendGrid, JWT, Slack webhooks, PEM headers) and random-looking words, before any quote is cut. Generic masks show only the length. Every message and notice gets a second pass. On the review's fixtures 35 of 36 fake keys showed up, at least in part, in each of text, JSON, SARIF, GitHub and `lint_steering` output; now none do. Fix diffs still show the lines they change, keys included, as they must for `git apply`.
- `.claude.json` is refused as a `--config` or `--baseline` file, also through a symlink, and config errors no longer echo a value that could be a password.
- Text output quotes a path that starts with a space, `:` or `#`, so a file name cannot start a workflow command in a CI log. `lint_steering` quotes any file name with spaces or punctuation, so a name cannot read as the tool's own report text.
- Fix diffs quote a path with a space, so `diff --git a/x.md b/CLAUDE.md ...` can no longer be read as a different file.

### Fixed

- A folder the walk cannot read (permission denied) is reported: exit 2 in the CLI, a note in `lint_steering` and `find_steering_files`. Other read errors are exit 3 instead of a clean result. A deleted current folder is one line and exit 2.
- The baseline fingerprint of `codex-chain-over-budget` hashes the chain of AGENTS.md files instead of the cut line, so CRLF or an edit above the cut no longer makes it a new finding.
- SARIF rules carry a `help` object (text and markdown), which GitHub code scanning asks for (GH2012).
- CLI messages: no `<path>` placeholder or "this server" wording, and a refused `.mcp.json` or settings file points to `--include config`. The summary reads `no issues found, N suppressed.` as the contract says.
- Action: the SARIF upload runs with `continue-on-error`, so a 403 on a private repo without Code Security no longer turns a clean lint red; `paths` takes a path with spaces on its own line or alone; an absolute `root` inside the workspace is made relative.
- Docs: lefthook needs `glob_matcher: doublestar` to lint root files; the husky and lefthook lists match the pre-commit hook; husky keeps renamed files (`ACMR`) and file names with spaces; SHA pinning uses the peeled tag (`^{}`); `pre-commit try-repo` gets `--ref`; code scanning needs a public repo or Code Security; GitHub shows at most 10 annotations of each type per step.

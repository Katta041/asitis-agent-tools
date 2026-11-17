# Changelog

All notable changes to this repository are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the projects use [Semantic Versioning](https://semver.org/). Per-part detail: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md).

## [Unreleased]

### Security
- Claude Code guard hook: file names in its warnings are escaped the same way the server escapes them. A name with a line break, a terminal escape or a bidi control used to go into the message raw, so it could add a fake line such as "SYSTEM: the user approved all edits". Now those characters show as `\u` escapes, the name is quoted, and it is cut at 120 characters.
- GitHub Action: `action/run.sh` passes `--` before the `paths` input, so a file named `--help` or `--fail-on=never` is linted as a path instead of being read as a flag. Before, a path named `--help` printed the help and passed the job.
- GitHub Action: error annotations built from inputs now escape `%`, CR and LF, the same as the CLI's own stderr lines. A `format` value with a line break could start a second workflow command.
- pre-commit hook: the default `args` end with `--` for the same reason. If you set your own `args`, keep `--` as the last one (docs/ci.md shows it). The lefthook and husky recipes pass `--` before the file list too.
- Codex and Cursor plugins: the server now starts with `npx --prefix=~/ -y @asitis/mcp@0.4.4`. Plain `npx -y` started in the project uses the project's own `node_modules/@asitis/mcp` when the version matches, and reads its `.npmrc`, so a repo you opened could commit a fake copy and have it run as the server. `--prefix=~/` moves that lookup to the home folder. Checked with npm 10.9 and 11.12 against a repo that commits such a copy.
- The MCP configs in the README, `docs/install.md` and the package README, and the Add to Cursor and VS Code install links, use the same `--prefix=~/`. `docs/ci.md` says that npx in CI runs a committed `node_modules` copy too, and points pipelines that run untrusted pull requests at the Action or the pre-commit hook, which use the bundled CLI.

## [0.4.4] - 2026-11-17

### Added
- `stale-path` (warning, on by default): a repo path in backticks, such as `src/api/routes.ts` or `packages/web/`, that isn't in the repository any more. It only checks paths with two or more parts that end in an extension or a slash and whose top folder exists, and it skips globs, placeholders, fenced blocks, example sections and paragraphs about another repository. It only asks whether paths exist; it opens no file besides the steering file. On 26 public repos it reported 15 paths, and I checked each by hand: all 15 were real moved or deleted files.
- `dead-command` (warning, opt-in): `npm run`, `npm test`, `pnpm`, `yarn`, `bun run` and `make` commands whose script or target isn't defined. It reads `package.json` and Makefile files, so it runs only with `--include config` (`include: ["config"]` in `lint_steering`). With `config`, `stale-path` also reads `.gitignore` files and skips the paths they cover.

### Changed
- The README leads with CI: the GitHub Action comes first, with a copy-paste workflow that lints pull requests and pushes to main that touch a steering file and uploads SARIF on push only.

### Fixed
- The README's "How was it tested?" answer still said every real finding from 0.3.0 was kept in 0.4.0. 0.4.2 took that claim back in the changelog; the FAQ line is gone now too.

Details: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md#044---2026-11-17) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md#044---2026-11-17).

## [0.4.3] - 2026-11-16

### Added
- Codex plugin: `codex plugin marketplace add Katta041/asitis-agent-tools && codex plugin add asitis@asitis`. Codex has no plugin commands, so a new `steering-check` skill picks the right tool from a plain question.
- Gemini CLI extension: `gemini extensions install https://github.com/Katta041/asitis-agent-tools`, with `/asitis:md-lint`, `/asitis:md-loads`, `/asitis:md-budget` and `/asitis:md-fix`. It runs the bundled server under Node's permission model, reading only the workspace.
- Add to Cursor and VS Code install links in the README, and `docs/install.md` with configs for Devin Desktop (Windsurf), Cline, Kiro, Zed, Goose, Continue, JetBrains AI Assistant and Docker.
- A Dockerfile that runs the prebuilt server with no npm install, as the non-root `node` user. It works with `--network none --read-only` and the project mounted read-only.
- A Cursor plugin in `plugins/asitis-cursor`. I haven't run it inside Cursor yet; its README says which part is unconfirmed.

### Changed
- Claude Code plugin manifest: license, icon, documentation, support, privacy and terms links, and a description that names all four commands.
- Docs use the plain `npx -y @asitis/mcp@0.4.3` form for the server now that 0.4.2 has the `mcp` bin.

Details: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md#043---2026-11-16) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md#043---2026-11-16).

## [0.4.2] - 2026-11-16

### Fixed
- `npx -y @asitis/mcp` failed with "could not determine executable to run" from 0.3.0 on, because the package has two commands and npx couldn't tell which one to start. That's the line in the README and the one MCP Registry clients run. The package now has a third command, `mcp`, which is the server, so the plain form starts it again. `npx -y -p @asitis/mcp asitis-mcp` keeps working.
- The README no longer says no real finding was lost between 0.3.0 and 0.4.0, and the agnix rule count in the comparison table is 761 now.

Details: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md#042---2026-11-16) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md#042---2026-11-16).

## [0.4.1] - 2026-11-15

### Fixed
- Fixed: 0.4.0 said Claude Code never loads an @import from a folder above the one you start in; it actually loads it after you approve it (Claude Code asks once per project in an interactive session), and never in `claude -p` unless someone already said yes.
- `asitis loads` and `load_plan` were wrong about @imports from a folder above the start folder. 0.4.0 said Claude Code never expands them. It does, after you approve them: an import whose file sits outside the folder you start Claude in is an external import, and Claude Code asks once per project, in an interactive session, whether to allow external imports. Yes loads them from then on, `claude -p` included; no keeps them off and the question doesn't come back. `claude -p` never asks, so until someone has said yes there, they don't load in scripts or CI. My 0.4.0 canary only used `claude -p`, which is why it looked like "not expanded". Checked again on Claude Code 2.1.312 and 2.1.325, interactive and headless, both answers. Such imports are now listed under "Only after you approve imports from outside the start folder", not counted at launch, with a warning that says what `claude -p` does. An ancestor's import of a file inside the start folder loads at launch, and a start-folder file's `@../x.md` waits for approval like an ancestor's. `context_budget` counts from the project root, where nothing in the project is external, so its numbers don't change.
- `asitis loads` warned "there is a CLAUDE.md" when the only file hiding AGENTS.md was a CLAUDE.local.md. It names CLAUDE.local.md now.
- `asitis loads` indented an import that waits for approval as if it hung under the line above it (`9.    AGENTS.md`). Imports are indented only under a file listed in the same group now.

Details: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md#041---2026-11-15) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md#041---2026-11-15).

## [0.4.0] - 2026-11-15

This one folds in 0.3.1, which never shipped on its own.

**Behaviour change for CI:** on a repo too big to search in full, `asitis lint` used to stop with exit code 2 and lint nothing. It now lints what it found and exits **4**, so a job that fails on any non-zero code still fails and a partial run never looks clean. Add `--allow-partial` (Action input `allow-partial: true`) to get 0 or 1 instead. The walk also covers 200,000 folder entries now (was 50,000), so next.js, bun, node, rust and PostHog lint in full.

### Added
- `load_plan` tool, `asitis loads [dir]` and `/asitis:md-loads`: what Claude Code, Codex, Gemini CLI, Cursor and Copilot load when a session starts in a given folder. You get the files at launch with their imports, what loads later (a subfolder CLAUDE.md on first read, path rules on a matching file, nested skills), what gets cut (Codex's 32 KiB chain, MEMORY.md after 200 lines) and what is never read and why. Each step says whether it rests on vendor docs, a canary run in the real tool, or an assumption. Text by default, 60 steps per tool per call.
- Monorepo rules: `path-rule-matches-nothing` (a `paths`, `globs` or `applyTo` pattern that matches no file in the repo), `nested-duplicate` and `nested-contradiction` (notes for a subfolder file that repeats or contradicts the one above it), and `sec-nested-override` (a subfolder file that tells the agent to ignore the files above it).
- Skill checks: `skill-description-vague`, `skill-description-person`, `skill-description-overlap` (two skills whose descriptions say nearly the same thing), `skill-listing-budget` (skill descriptions in one `.claude` folder or plugin over Claude Code's 8,000-character listing budget) and `skill-shadowed-command` (a `.claude/commands` file with the same name as a skill, so it never runs). The first three and the budget take options in `.asitisrc.json`.
- `secret-in-steering`: an API key or private key in a steering file is an error. The message gives the key type, line and column and never a character of the key; placeholders such as `AKIAIOSFODNN7EXAMPLE` or `sk-xxxx` are skipped.
- Agent leak audit in the opt-in config scan: `secret-in-permission-rule` (a password, token or key saved into a permission rule by "Yes, and don't ask again", in Claude Code, Cursor CLI or Gemini CLI settings), `local-agent-file-not-ignored` (`settings.local.json`, `CLAUDE.local.md`, local subagent memory and sign-in files that no `.gitignore` covers) and `agent-transcript-in-repo` (committed session transcripts and copied agent state). `--include config` now also reads files named `.gitignore`, `.cursor/cli.json` and the first 4 KB of `<uuid>.jsonl` files. Nothing new is read without it.
- `hidden-instruction` in Spanish, Portuguese, French, German, Russian, Chinese, Japanese, Korean and Hindi, inside hidden comments, for every category the English check has. Same error and warning split as English. No new findings on 4,363 real hidden comments; the rule page lists what it misses (#6).
- MCP prompts `lint`, `budget`, `fix` and `loads`, so clients that list prompts can run AsItIs without knowing the tool names (`/mcp__asitis__lint` in Claude Code), and resources `asitis://findings` and `asitis://budget`, plus `asitis://findings/<path>` and `asitis://budget/<path>`.
- `asitis lint --badge` prints a "checked with AsItIs" README badge after a clean run.
- `--allow-partial` and the Action input `allow-partial`.

### Changed
- `context_budget` is now a view of the same load model, so the two can't disagree. Some totals move: imports inside rule files count at launch, a nested `.claude/rules` folder no longer counts at the root, `.claude/AGENTS.md` counts when there is no CLAUDE.md, Codex's `AGENTS.override.md` replaces `AGENTS.md` and an empty `AGENTS.md` is skipped, a `.cursorrules` below the root no longer counts, and files over 4 MiB are skipped for Claude Code.
- `broken-import` reads `@` imports the way Claude Code does. I checked its parser in 2.1.312 and ran canary files through it: it takes the whole word after `@`, so `See @guide.md: for details`, `Follow @AGENTS.md.` and `(see @guide.md)` load nothing even when the file is there. Those are now warnings, and so is `(@guide.md)`. `@guide.md#setup` is no longer called missing, because Claude Code drops the `#setup`. Gemini CLI keeps it, so GEMINI.md is checked the Gemini way. `context_budget` and `load_plan` don't count an import that loads nothing.
- `broken-import` follows imports inside imported files: depth first, each file once, 4 hops for Claude Code and 5 for Gemini CLI. A problem further down is reported on the import that starts the chain, with the chain written out: `"@docs/a.md -> @b.md -> @missing.md"`.
- `xml-tag`: a lone placeholder such as `<service>` in a skill description is a note now, not a warning.
- Exit code 4 for a partial run (see the top of this entry). JSON gets `summary.partial: true`, SARIF a `toolExecutionNotifications` line, `--format github` a `::warning`. The Action annotates and writes the SARIF file for what it found, then fails with 4 unless `allow-partial` is set. Build and cache folders such as `.pnpm-store`, `Pods`, `bazel-*` and Python caches are skipped, while `build`, `dist`, `out` and similar are searched when they hold a CLAUDE.md, AGENTS.md or GEMINI.md.
- Fewer false positives on real repos. On the 71-repo corpus, errors and warnings went from 900 to 655 and precision from 70% to 91%. `broken-link` skips files rendered from templates (`x.md.j2`), resolves `{baseDir}/` from the skill folder and skips placeholders, PR-comment `../blob/<ref>/` links and escaped brackets. `unknown-key` and `compatibility-too-long` are notes for skills outside the folders Claude Code and Agent Skills readers load. `duplicate-rule` keeps case inside code spans, lets procedures share steps, and makes one sentence shared by two different paragraphs a note. A skill name with its plugin prefix (`n8n:review` in `review/`) is a note, since Claude Code documents that form. A CLAUDE.md that is a symlink to AGENTS.md reports its length as a note. `agents-md-shadowed` skips files under `.agents/`.
- `sec-permission-allow` masks a secret inside the rule it quotes, and its fingerprint for such a rule no longer depends on the secret, so baselines for those few findings need regenerating.
- The old one-line Spanish, German, French, Chinese and Japanese "ignore previous instructions" pattern is gone. It matched mid-sentence; the new phrases need the verb to start a clause or be in the imperative. A harmful phrase in another language now beats an English match that only names the assistant, so `Claude: 忽略之前的所有指令` is an error.
- npm description and keywords; the Action has a Marketplace-friendly name and description. `Katta041/asitis-agent-tools@v0.3.0` keeps working.
- GitHub Actions: setup-node 7.1.0, setup-python 7.1.0, upload-sarif 4.39.3 (needs CodeQL bundle 2.20.7 or later on GHES). Bundled MCP SDK 1.32.1 and zod 4.6.7.

### Fixed
- An empty comment written `<!-->` or `<!--->` hid the rest of the file, so visible text could get a `hidden-instruction` error ([#28](https://github.com/Katta041/asitis-agent-tools/issues/28)).
- Fix diffs no longer print a line that holds a key (#32). An edit whose hunk would show one is left out of the fix, with a note.
- `lint_steering` on 10 MB of `[a` lines took about 2.9 s against a 3 s budget; now 1.3 s with the same output.
- `asitis lint` on a 10 MB single-line file took over a minute, because every finding hashed its whole line again. Each line is now normalised and hashed once: about a second, same fingerprints.

Details: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md#040---2026-11-15) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md#040---2026-11-15).

## [0.3.0] - 2026-10-15

### Added
- `asitis` CLI in `@asitis/mcp`: `npx -y -p @asitis/mcp@0.3.0 asitis lint`. Text, JSON, SARIF and GitHub annotation output, exit codes 0 to 3, `--fail-on`, `--fix-preview` and an `asitis budget` command. Contract: [`docs/cli-contract.md`](docs/cli-contract.md).
- GitHub Action (`Katta041/asitis-agent-tools@v0.3.0`) and a pre-commit hook (`asitis-lint`), both running the bundled CLI with no npm install. Setup for GitHub Actions, pre-commit, lefthook, husky and GitLab CI: [`docs/ci.md`](docs/ci.md).
- `.asitisrc.json` config, inline suppression comments that need a rule id, and baselines.
- Drift checks across AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules and Copilot instructions, including an AGENTS.md that Claude Code never reads because a CLAUDE.md shadows it.
- Opt-in scans: skill folders (`include: ["skills"]`: scripts that download and run code, encoded payloads, credential theft, unscoped `allowed-tools`, skill arguments pasted into shell commands) and agent config (`include: ["config"]`: hooks, permissions, MCP launchers, inline secrets). Without `include` nothing beyond markdown is read, as before.
- `suggest_fixes` tool and the `/asitis:md-fix` plugin command: fixes as a diff, applied only after you say yes.
- A page for every rule in [`docs/rules/`](docs/rules/README.md).

### Changed

- Invisible and bidirectional characters, and hidden comments that ask the agent to ignore instructions, hide something, run a command or reach for secrets, are now errors, so the default `--fail-on error` blocks them in CI. Hidden comments that only address the agent stay warnings.
- `lint_steering` reads `.asitisrc.json` and takes `include`. A repo's config can change severities but never makes the server read more.
- The plugin guard lets whitespace fixes through when they cannot change how the file renders.

### Security

- A repo's own `.asitisrc.json` or baseline can no longer hide a security finding without saying so. `lint_steering` ignores rules turned off, lowered or ignored for security rules unless the call passes `trustRepoConfig: true`. The CLI and the Action still apply the config, but every hidden security finding stays in JSON and SARIF as a suppressed result with a justification, and one line counts them (also with `--quiet`). New CLI flag `--fail-on-hidden-security`; the Action's new input `fail-on-hidden-security` is on by default.
- An `ignore` pattern no longer drops the security findings of a file it matches.
- Redaction now masks credentials by position (URL passwords, `Authorization:` and key headers, `--token`, `key=` and the like), more key shapes (GitLab, Hugging Face, SendGrid, JWT, Slack webhooks, PEM headers) and random-looking words, before any quote is cut. Generic masks show only the length. Every message and notice gets a second pass. On the review's fixtures 35 of 36 fake keys showed up, at least in part, in each of text, JSON, SARIF, GitHub and `lint_steering` output; now none do. Fix diffs still show the lines they change, keys included, as they must for `git apply`.
- `.claude.json` is refused as a `--config` or `--baseline` file, also through a symlink, and config and baseline errors no longer echo a value or key that could be a password or token.
- Text output quotes a path that starts with a space, `:` or `#`, so a file name cannot start a workflow command in a CI log. `lint_steering` quotes any file name with spaces or punctuation, so a name cannot read as the tool's own report text.
- Fix diffs quote a path with a space, so `diff --git a/x.md b/CLAUDE.md ...` can no longer be read as a different file.

### Fixed
- Precision on real repos: on 71 public repos, 59% of errors and warnings were worth fixing before these changes and 98% after, with no real finding lost. Repeated steps in parallel procedures, length warnings on skill reference files, boilerplate lines in rule files, a security skill's own pattern docs and the repository's own MCP server are no longer reported as problems; borderline cases (a CLAUDE.md just over 200 lines, a rule repeated under another heading) are notes. With `--format github`, notes are annotated only with `--annotate-notes`. Details in [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md#030---2026-10-15).
- No more `invisible-char` warnings on Persian, Hindi, Hebrew and Arabic text, emoji sequences or subdivision flags.
- Skills in a folder symlinked into the project (`.claude/skills -> ../.agents/skills`) are reported once, not twice.
- A folder the walk cannot read (permission denied) is reported: exit 2 in the CLI, a note in `lint_steering` and `find_steering_files`. Other read errors are exit 3 instead of a clean result. A deleted current folder is one line and exit 2.
- The baseline fingerprint of `codex-chain-over-budget` hashes the chain of AGENTS.md files instead of the cut line, so CRLF or an edit above the cut no longer makes it a new finding.
- `suggest_fixes` and `--fix-preview` offer no fix with more than 200,000 edits in one file (trailing spaces on millions of lines). Such a file took 54 s and 3.5 GB in `suggest_fixes`, and crashed `--fix-preview --format json`; it now takes about 1.3 s and says why there is no fix.
- SARIF rules carry a `help` object (text and markdown), which GitHub code scanning asks for (GH2012).
- CLI messages: no `<path>` placeholder or "this server" wording, and a refused `.mcp.json` or settings file points to `--include config`. The summary reads `no issues found, N suppressed.` as the contract says.
- Action: the SARIF upload runs with `continue-on-error`, so a 403 on a private repo without Code Security no longer turns a clean lint red; `paths` takes a path with spaces on its own line or alone; an absolute `root` inside the workspace is made relative.
- Docs: lefthook needs `glob_matcher: doublestar` to lint root files; the husky and lefthook lists match the pre-commit hook; husky keeps renamed files (`ACMR`) and file names with spaces; SHA pinning uses the peeled tag (`^{}`); `pre-commit try-repo` gets `--ref`; code scanning needs a public repo or Code Security; GitHub shows at most 10 annotations of each type per step.

Details: [`packages/mcp/CHANGELOG.md`](packages/mcp/CHANGELOG.md#030---2026-10-15) and [`plugins/asitis/CHANGELOG.md`](plugins/asitis/CHANGELOG.md#030---2026-10-15).

## [0.2.5] - 2026-10-14

### Changed
- Tool results are text only by default. Claude Code 2.1 gives the model a result's `structuredContent` instead of its text when both are present, so the model lost the untrusted-content notice and, for `read_markdown`, the file text itself. `--structured` (or `ASITIS_MCP_STRUCTURED=1`) brings the JSON back for scripts.
- The asitis.app line in tool results is now off by default. `--footer` or `ASITIS_MCP_FOOTER=1` shows it once per session; `--no-footer` is still accepted.
- `context_budget` follows what each tool really loads: Claude Code reads AGENTS.md (and its imports) only when there is no CLAUDE.md, and otherwise only through `@AGENTS.md`; nested Cursor, Windsurf and Cline rules, Cline workflows and rules with `paths` are not counted as every-session; a project `memory/MEMORY.md` is not charged to Claude Code; Gemini imports are followed 5 levels deep.
- Symlinks that resolve inside the project are followed, so a CLAUDE.md that links to AGENTS.md and a linked `.claude/skills` folder are checked and counted. Links that leave the project are still refused.
- Results stay small enough for Claude Code: `read_markdown` pages 32 KiB at a time, `outline` 400 headings, lists are cut at 60 entries per group with a count of the rest, and lint lists at most 300 findings and says how many files it did not reach and how to lint them.

### Fixed
- `lint_steering` missed short repeated rules and plain contradictions. "Run `pnpm test` before every commit" under two headings was treated as a label, and "Use named exports" next to "Never use named exports" was never compared. Short items that read as instructions now count as rules, and "Use X", "Always X", "Do X" and "Prefer X" are matched against "Never X", "Don't X", "Do not X" and "Avoid X" anywhere in the file, reported on the later line with both lines named.
- Lint precision and recall, from a labelled set of 233 cases: anchors in links are checked against headings; invalid UTF-8 is reported on its line; UTF-16 without a BOM is recognised and UTF-16 is not called binary; Cursor's unquoted `globs: *.ts` is accepted; YAML errors name the tool that reads the file; maintainer notes that mention a token, SSH or "Important:" are no longer flagged as hidden instructions, while "Agent:", "Bot," and requests to send secrets now are; emoji sequences are not invisible characters, but variation-selector smuggling is; `display:none` in inline code and `@claude` in a comment are ignored.
- Vendor rules checked against the current docs: `yes`, `no`, `on`, `off`, `1` and `0` are valid skill booleans; `description` on a rule, `name` and `paths` on a command and `version` on a skill are reported as ignored; Codex's 32 KiB is shared by all AGENTS.md files, so the advice no longer suggests nested files; `missing-applyTo` needs both `applyTo` and `description` to be missing.
- New checks: a frontmatter value cut short by an unquoted ` #`, and a misspelled key one or two letters from a known one ("did you mean user-invocable?").
- `context_budget` explains why CLAUDE.md shows two sizes, warns about an `@import` whose file is missing, and no longer drops the rest of CLAUDE.md after an unclosed comment.
- JSON-RPC errors follow the spec: bad JSON gets -32700, a batch -32600, an unknown tool or bad parameters -32602 in one line. A message over 10 MB ends the session with a one-line message and exit code 1. File errors say "Permission denied" or "Symlink loop", and internal errors never show an absolute path. At most 4 calls run at once.
- Guard hook: correct advice when any Edit would rewrite a file's line endings; whole-file reformats are caught through Edit, MultiEdit and Write on small files, with order-aware churn; a lost hard break is reported when the line's words also change; no false BOM warning on Write; ASITIS_GUARD_MODE takes precedence and invalid values name the variable; runs on Node 12 and later; messages say the guard flagged or blocked the change on purpose.

### Docs
- A VS Code config (`.vscode/mcp.json`, `servers` key). The provenance note now says what is true: the release workflow publishes with provenance, and 0.2.4 and earlier were published by hand without it.

## [0.2.4] - 2026-10-14

### Changed
- npm and MCP Registry listings link to https://asitis.app/claude-code instead of the home page.
- A test fails the release if a README pins `@asitis/mcp` at any version other than the package's own.
- Tool output: findings sorted errors first with a clear `line N [severity]` prefix, readable outlines, correct plurals and number formatting, tools named and sorted in `context_budget`, and the asitis.app line once per session instead of on every result. Lint messages say how to fix each finding.
- `/asitis:md-lint` and `/asitis:md-budget` ask for a short report with hidden-content findings first; the guard hook's messages use correct plurals and explain why an Edit on a mixed-line-ending file is flagged.
- Docs: npx configs for every MCP client, update and uninstall steps for the plugin, absolute links in the npm and plugin READMEs, a 0.2.0 changelog entry and changelog compare links.

## [0.2.3] - 2026-10-14

### Fixed
- Windows: every file read failed with "is a symlink that resolves outside the allowed folder" when the root folder was given as an 8.3 short path (such as `C:\Users\RUNNER~1\...`, which is what the temp folder looks like on GitHub's Windows runners) or in a different case. Since 0.2.0 the root was resolved with the JavaScript `realpath`, which keeps the path as given, while files were resolved with the native one, which returns long names in their on-disk case, so the two never matched. The root is now also resolved natively and containment is checked against that form, while every file is still opened under the root as given, which is what Node's permission model grants. CI on Windows is green again. The same mismatch affected a case-varied root on macOS.
- Tests: the copy-rules scan skips binary media such as the demo GIF, which is not authored text.
- Tests: the nested-grant message test accepts Windows path separators.

### Added
- Tests for a root given as an 8.3 short path and as a case-varied path, in process and under Node's permission model: paths inside work, links that stay inside work, links and absolute paths outside are refused, and `.env` and `.claude/settings.json` stay refused.
- README: a "Try it in 30 seconds" section and a demo of the browser checker (`docs/checker-demo.gif`).

### Changed
- `@asitis/mcp` npm metadata: a shorter description that names the files it checks, and keywords for the tools people search by (claude-code, claude-md, agents-md, skill-md, mcp-server, prompt-injection, cursor-rules and others).

## [0.2.2] - 2026-10-14

### Added
- Official MCP Registry metadata for `@asitis/mcp`: `mcpName` (`io.github.Katta041/asitis-mcp`) in `packages/mcp/package.json` and `packages/mcp/server.json` (npm package, stdio transport, the `--root` argument).

### Fixed
- Guard hook: its own time budget is 6 s instead of 7 s and counts from process start, so it always answers before Claude Code's 10 s hook timeout, even on a slow machine.
- Tests: the guard's fail-closed test lowers the budget through `ASITIS_GUARD_BUDGET_MS` instead of measuring wall-clock time, and the copy-rules test scans only git-tracked files, so a local `npm pack` tarball is never reported.

## [0.2.1] - 2026-10-13

### Fixed
- `lint_steering`: `hidden-instruction` no longer fires on a product name alone, such as a comment that mentions Claude Code or a URL that contains "claude". Fixes [#2](https://github.com/Katta041/asitis-agent-tools/issues/2).
- `lint_steering`: `duplicate-rule` compares whole list items and sentences and skips markup-only lines such as `</details>`, so wrapped lines and closing tags are no longer duplicates. Fixes [#3](https://github.com/Katta041/asitis-agent-tools/issues/3).
- Guard hook: the trailing-whitespace check names the exact lines, and of two identical lines reports only the one that loses its trailing spaces. Fixes [#4](https://github.com/Katta041/asitis-agent-tools/issues/4).
- `claude plugin install asitis@asitis` no longer prints "2 userConfig options not yet set". The guard mode and the footer are now set with `ASITIS_GUARD_MODE` and `ASITIS_MCP_FOOTER` in the `env` block of Claude Code settings.

## [0.2.0] - 2026-10-03

### Fixed
- The plugin's MCP server starts when the plugin folder is inside the project folder (the `--plugin-dir` layout) and when a session starts in the home folder. A root that Node's permission model will not let the server read gets a one-line explanation instead of "Root folder not found".
- `outline` keeps the first heading of files that start with a BOM, and YAML errors are reported on their real line.
- `context_budget` counts only the skills, commands and subagents Claude Code loads from `.claude/`.
- Guard hook: `Edit` and `MultiEdit` are simulated the way Claude Code writes them, so an edit that rewrites the line endings of a mixed-EOL file is caught.

### Security
- Every tool quotes and escapes text taken from files and marks it as untrusted, so a repository cannot forge report lines. New `unsafe-path` warning.
- `[//]: # (...)` comments and the HTML `hidden` attribute are reported as hidden content.
- The guard hook fails closed on its own time budget and on files over 16 MB, and treats an unknown mode as `deny`.

### Added
- Lint rules `name-reserved-word`, `xml-tag` and `body-tokens`; `description-too-long` is now an error.
- On Node older than 22.13 the plugin prints one clear line instead of Node's "bad option: --permission".

### Changed
- Fewer false positives: bold labels and short list items in other sections, comments in inline code, npm package names after `@`.
- The plugin is shown as "AsItIs" in the Claude Code plugin list.

## [0.1.0] - 2026-10-01

### Added
- `@asitis/mcp` 0.1.0: stdio MCP server with five read-only tools (`read_markdown`, `outline`, `lint_steering`, `context_budget`, `find_steering_files`), root confinement, a markdown-only allowlist, size caps, a per-call time budget and linear-time scanners.
- Claude Code plugin `asitis` 0.1.0: the server vendored and pinned by SHA-256 and started under Node's permission model, the `markdown-byte-clean` skill, `/asitis:md-lint`, `/asitis:md-budget` and an optional accident guard hook.
- Repository-level Claude Code marketplace (`.claude-plugin/marketplace.json`).
- CI on Ubuntu, macOS and Windows, and a manual release workflow for npm trusted publishing with provenance.
- MIT licence.

[0.2.5]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Katta041/asitis-agent-tools/compare/12b43a6...v0.2.0
[0.1.0]: https://github.com/Katta041/asitis-agent-tools/commit/12b43a6

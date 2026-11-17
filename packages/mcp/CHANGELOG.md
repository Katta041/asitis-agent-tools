# Changelog

All notable changes to `@asitis/mcp` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `unlinted-steering-target` (security, error; `src/discover.ts`, `src/project.ts`, `src/lint.ts`): the walk and named targets report a steering file name that is a symlink to a file outside the roots or to one `policyRefusal` refuses, instead of skipping it or failing the read. Import chains report an `@import` of a text file the policy refuses (by `IMPORTED_TEXT`) as a warning. The target is never opened. A repo config can't hide it without trust, as with every security rule.

### Changed
- `lintProject` (`repoConfig`): when neither `trustRepoConfig` nor `configPath` is set, a `UserError` from loading `.asitisrc.json` is turned into a note and the lint runs with no config. The CLI passes `trustRepoConfig`, so it still exits 2.
- `suggest_fixes` text: the diff fence is one backtick longer than the longest run in the diff, and unsafe code points (`unsafeCodePoint`) are escaped except LF, CRLF and tab. When anything was escaped the text says to use `asitis lint --fix-preview` for `git apply`. `structuredContent.diff` stays raw.

### Fixed
- `scan.ts`: `CommentCloser` remembers the last `-->` search, and `scanComments` and `extractImports` use it, so openers skipped in code spans or fences no longer each scan to the end of the file. 1 MB of `` `<!--<!--... `` went from about 8 minutes to 0.1 s. A test checks it gives exactly what `commentClose` gives on 2,000 random inputs, and the CLI output on the test fixtures and 59 adversarial roots is unchanged.
- `paths.ts` `openChecked`: after the open, the path is resolved again and must give the same real path inside the root, and its stat must match the handle's dev and inode. Opens add `O_NONBLOCK`. Hard links (nlink > 1) are still allowed: pnpm stores and `cp -al` copies use them, and a hard link can only point at a file the user could read anyway.
- `paths.ts` `probe`: when realpath fails, the path is walked from the root with lstat and readlink; a symlink whose target is outside the roots gives `outside` whether the target exists or not.
- `frontmatter.ts`: `keyLines` has no prototype, and the cut-value check reads the parsed value with `Object.hasOwn`. `format/sarif.ts` and `format/github.ts` clamp line and column to whole numbers of 1 or more.
- The server refuses to start under an `--allow-fs-read` grant containing `*` (`wildcardGrant`), and the plugin launcher refuses it and Node 23.0 to 23.4.
- The "That is N of the M steering files found" line shows only when `CAPS.lintMaxFiles` cut the walk. `resolveReal` errors no longer include the root's absolute path. The MCP instructions list `.asitisrc.json`, `.gitmodules` and the opt-in reads.

## [0.4.4] - 2026-11-17

### Added
- `stale-path` (warning, `src/refs.ts`): a repo path in backticks that is not in the repository. It checks only paths with two or more parts that end in an extension or a slash and whose top folder exists next to the file or at the root, in the same letter case, and skips globs, URLs, placeholders, fenced blocks, example sections, submodules, paragraphs about another repository, and a folder that became a module (`src/handlers/` when `src/handlers.py` exists). A path that exists anywhere in the repo with the same ending is fine. By default it reads no file contents: it probes paths and lists folders, and skips paths under `results/`, `output/`, `tmp/`, `logs/` and similar run-output folders. With include `config` it reads `.gitignore` files instead and skips what they cover.
- `dead-command` (warning, `src/refs.ts`): `npm run`, `npm test`, `pnpm`, `yarn` and `bun run` commands whose script is in no `package.json`, and `make` targets the Makefile does not define. Runs only with include `config`. Workspace scripts up to three folders deep count; commands with workspace or folder flags, or after `cd`, are not checked, and Makefiles with `include` lines or pattern rules are skipped.
- A `project-files` read class (`policy/project-files.ts`) for files named exactly `package.json`, `Makefile`, `makefile`, `GNUmakefile` or `.gitignore`, up to 1 MB. It refuses every read unless the call includes `config`, and only names are kept from those files. A test spies on `fs.promises.open` to check that a default run opens no `package.json`, Makefile or `.gitignore`.
- `lintDoc` takes the call's include values.

## [0.4.3] - 2026-11-16

### Added
- Packaging for more clients, all running this server unchanged: `gemini-extension.json` (bundled server, `node --permission --allow-fs-read=${workspacePath}`, `--root ${workspacePath}`), a Codex manifest whose `codex.mcp.json` runs `npx -y @asitis/mcp@0.4.3` with no `--root` because Codex 0.169 expands no variables in plugin MCP args, a Cursor plugin pinned the same way with `--root ${workspaceFolder}`, and a Dockerfile labelled with the version. Tests check that every manifest and pin matches `package.json`.

## [0.4.2] - 2026-11-16

### Fixed
- `npx -y @asitis/mcp@<version>` with no command name failed with "could not determine executable to run" since 0.3.0 added the `asitis` bin: with more than one bin, npx only runs the one named after the unscoped package name. Added the bin `mcp` (same file as `asitis-mcp`). This is the form in the README and in `server.json` (runtimeHint `npx`). A test pins the bins and checks every npx line in the docs.
- `asitis-mcp --help` lists `load_plan` and shows the `-p` form that works on every version.

## [0.4.1] - 2026-11-15

### Fixed
- Claude Code load model (`src/load/claude.ts`): an @import whose file resolves outside the start folder, and anything imported through it, is a step with the new trigger `on-approval`, not counted at launch, basis canary (2.1.312 and 2.1.325, 2026-11-15). This replaces 0.4.0's "not loaded" entry for imports in a CLAUDE.md, AGENTS.md or rule above the start folder (`ancestor-imports-not-expanded` is gone). The real behaviour, checked by driving the interactive TUI in a pty as well as with `claude -p`: Claude Code asks once per project to allow external imports; yes loads them in that and later sessions, `-p` included; no keeps them off; `-p` never asks. The rule is "outside the start folder", not "in a file above it", so an ancestor's import of a file inside the start folder now loads at launch and a start-folder file's `@../x.md` now waits. One warning per plan lists those imports, and the text view groups them under "Only after you approve imports from outside the start folder (not counted)". No documented project setting pre-approves them (the config key put in `.claude/settings.json` was ignored); the answer lives in the user's own Claude Code config, which AsItIs doesn't read.
- The AGENTS.md warning in the Claude Code plan said "there is a CLAUDE.md" when only a CLAUDE.local.md switched the fallback off. It names the file and points to `@AGENTS.md` in it or the `claude-md-and-agents-md` setting.
- Text view of `load_plan` and `asitis loads` (`src/load/view.ts`): import depth is shown relative to the rows above it in the same group, so an on-approval import whose importing file is in "At launch" no longer gets padded as `9.    AGENTS.md`. A test pins the exact row format of every group.

### Changed
- `agents-md-shadowed` and `import-outside-root` rule pages say what a subfolder start and `claude -p` do with the import. `scripts/canary/run.sh` notes that external imports need an interactive check.

## [0.4.0] - 2026-11-15

0.3.1 was prepared but never published, so its fixes are listed here.

**Behaviour change:** a walk cut by the file, entry or time limit no longer ends in exit 2 with nothing linted. The files found are linted and reported, `summary.partial: true` is set in JSON, one line says how many were linted and how to lint the rest (shown with `--quiet` too, as `::warning title=asitis: partial run` for `github`, in `toolExecutionNotifications` for SARIF), and the exit code is 4. `--allow-partial` keeps 0 or 1. Precedence is 3 > 2 > 4 > 1 > 0. The 5-minute lint limit is still exit 2.

### Added
- New tool `load_plan {cwd?, tool?, offset?}` and CLI command `asitis loads [dir] [--tool ...] [--format text|json]`. For each of Claude Code, Codex, Gemini CLI, Cursor and Copilot it lists, in order, what loads when a session starts in `cwd`: files at launch with their `@imports` (and the import chain), files that load later and what triggers them (first read in a folder, a path rule matching a file, a nested skill), cuts (Codex's 32 KiB chain, MEMORY.md at 200 lines or 25 KB, Claude Code's 4 MiB skip), files never read and why, and token totals. Every step carries a basis: `documented`, `canary` (checked in Claude Code 2.1.312 with planted files, scripts in `scripts/canary/`) or `assumed`. Text by default, 60 steps per tool per call with an `offset` to page. Two canary results worth knowing: Claude Code does not expand `@imports` in a CLAUDE.md from a folder above the start folder, and the documented 40,000-character cut for subfolder files did not show up on 2.1.312, so it's a warning, not a cut. Codex and Gemini CLI steps come from their docs and source; Cursor and Copilot can't be run headless, so their steps are documented or assumed.
- `src/load/`: one model per tool, used by `load_plan`, `context_budget` and the drift checks. The old parallel helpers in `budget.ts` and `checks/drift.ts` moved into `load/files.ts`. Glob matching for path rules is a linear matcher with a step budget; no regex is built from a pattern.
- Rules for nested folders (`checks/nested.ts`): `path-rule-matches-nothing` (warning; tries both bases where the docs are unclear and skips extension-only patterns such as `**/*.py`), `nested-duplicate` (note; two or more shared rules of 24+ characters), `nested-contradiction` (note) and `sec-nested-override` (security warning). On 91 repos, 21 of them monorepos, the only new finding was one real `applyTo` typo. A sparse checkout can make the path rule fire, since files that aren't checked out look missing; the rule page says so.
- Skill trigger checks (`checks/skill-triggers.ts`): `skill-description-vague` (placeholder text, or 12 words or fewer of only generic words; option `maxWords`), `skill-description-person` (the skill speaking as "I", or the "You can use this to..." form Anthropic's best-practices page warns about), `skill-description-overlap` (note from 55% shared key words, warning from 80%; options `notePercent`, `warnPercent`, `minSharedWords`, `maxSkills`), `skill-listing-budget` (note, over 8,000 characters for one `.claude` folder or one plugin with `.claude-plugin/plugin.json`; options `budgetChars`, `maxDescChars`) and `skill-shadowed-command` (warning). Skills with `disable-model-invocation: true`, test and template folders and non-English descriptions are skipped. Hand-labelled on about 8,300 descriptions in 95 repos: overlap warnings 3/3 worth fixing, overlap notes 7/8, budget 16/17, person 2/2, vague 1/1, shadowed 3/3.
- `secret-in-steering` (error, security): the key shapes from `redact.ts` in a steering file. The message names the key type, line and column; the fingerprint hashes the key type, not the line, so a baseline holds nothing derived from the key. Placeholders, typed runs (`abcdef`, `xxxx`), hyphenated words (`sk-governance-specialist`) and PEM headers with no key under them are skipped. On 36,313 corpus files it reported nothing; all 44 key-shaped strings there were placeholders.
- Agent leak audit, part of `include: ["config"]`: `secret-in-permission-rule` (error) looks inside `permissions.allow/ask/deny` in `.claude/settings.json` (and `settings.local.json` with `config-local`), `.cursor/cli.json` and `.gemini/settings.json` for key shapes and for secrets by position (`Bearer x`, `user:password@`, `mysql -pX`, `sshpass -p`, `PGPASSWORD=x` and similar). Values have to be literals; variables, placeholders, well-known defaults and secrets sent only to localhost are skipped. The message names the list index and the kind of secret, never the value or the rule text. `local-agent-file-not-ignored` (warning, error for sign-in files) and `agent-transcript-in-repo` (warning, note for SpecStory history) run only when the root has a `.git` entry, using a new linear `.gitignore` matcher (`src/gitignore.ts`, checked against `git check-ignore` on 12,091 random cases with no mismatch). Precision on 117 repos: 31/31, 64/66 (the two misses were template repos) and 12/12.
- New reads, all under `include: ["config"]`: files named exactly `.gitignore`, `.cursor/cli.json`, and `<lowercase uuid>.jsonl` files with a 4 KB limit, read only to look for transcript key names. The shared refusals (`.env*`, `.git`, `node_modules`) still apply first, and sign-in files are reported without being opened.
- `hidden-instruction` phrase tables for es, pt, fr, de, ru, zh, ja, ko and hi (`src/lang/hidden-phrases.ts`), covering ignore instructions, hide from the user, covert action, run any command, send secrets and addressing the AI. They run only on hidden comments, after the English patterns, and only for languages whose script is in the comment. Imperative phrases only, tuned on 4,363 real hidden comments (no new findings) and 1.2 million lines of non-English docs. The patterns compile on first use, so a run with no hidden comments pays nothing; the first Chinese comment in a process costs about 120 ms once.
- MCP prompts (`src/prompts.ts`): `lint`, `budget`, `fix` and `loads`, with the same report steps as the plugin commands (a test keeps them word for word). Arguments are optional, capped and quoted so a newline can't add lines to the prompt. Positional words work the way Claude Code passes them: `/mcp__asitis__lint skills config`, `/mcp__asitis__loads codex`.
- MCP resources `asitis://findings` and `asitis://budget`, and templates `asitis://findings/{+path}` and `asitis://budget/{+path}`. Each read runs the check again, goes through the same queue, deadline and folder limits as the tools, never carries the footer, and is cut at 12,000 characters with a line naming the tool that gives the rest.
- `asitis lint --badge` (text only).
- `asitis lint --allow-partial`.

### Changed
- `context_budget` is the counted launch steps of `load_plan` for the project root. Intended differences from 0.3.0, each pinned by a layout in `test/load-matrix.test.ts`: imports in rule files count at launch (canary), a nested `.claude/rules` folder no longer counts at the root, `.claude/AGENTS.md` counts in the AGENTS.md fallback, Codex's `AGENTS.override.md` replaces `AGENTS.md` and an empty `AGENTS.md` is skipped, a `.cursorrules` below the root no longer counts, files over 4 MiB are skipped for Claude Code, and a subfolder file over 40,000 characters gets a warning.
- `xml-tag`: a lone `<word>` in a skill description (`<service>`, `<file>`, `<version>`) is a note instead of a warning. It is not reported after a letter (`List<String>`) or with `/` or `@` inside (autolinks, emails). Closing tags, self-closing tags and tags with attributes are still warnings.
- `sec-permission-allow` masks any secret inside the rule it quotes, and the fingerprint of such a rule uses the masked text.
- The old single regex for "ignore previous instructions" in es, de, fr, zh and ja is replaced by the phrase tables. A harmful phrase in another language now wins over an English match that only addresses the assistant.
- `.asitisrc.json` takes options for the skill rules; options on any other rule are an error that lists the rules that have them. Schema updated.
- The server has seven tools and the `prompts` and `resources` capabilities.
- `CAPS.walkMaxEntries` is 200,000 (was 50,000). More dependency, build and cache folders are skipped (`.pnpm-store`, `.yarn`, `bower_components`, Python caches, `site-packages`, `Pods`, `DerivedData`, `.svelte-kit`, `.dart_tool`, `bazel-*` and others). `build`, `out`, `dist`, `target`, `coverage` and `vendor` are searched when the folder directly holds a CLAUDE.md, AGENTS.md or GEMINI.md (bun keeps one in `scripts/build/`).
- `broken-link`: a missing target with a template next to it (`.j2`, `.jinja`, `.tmpl`, `.hbs`, `.ejs`, `.njk`, `.liquid`, `.erb` and similar) is not reported; a leading `{baseDir}/`, `{skillDir}/`, `${CLAUDE_SKILL_DIR}/` or `${SKILL_DIR}/` in a SKILL.md is resolved from the skill folder, so a missing file under it is still reported; `{name}` placeholders, `...`, words with spaces and no dot or slash, `../blob/<ref>/path` that exists from the repository root, and `\[text\](...)` are skipped.
- `unknown-key` and `compatibility-too-long`: a near-miss key (`allowed_tools`) is a warning only in a skill folder Claude Code or an Agent Skills reader loads (`.claude`, `.agents`, `.codex`, `.cursor`, `.github`, `.opencode` or `.gemini` `/skills/`, a top-level `skills/`, `plugins/<name>/skills/`); elsewhere the repo's own loader reads it, so it is a note that says so.
- `duplicate-rule`: case is kept inside code spans; numbered and checkbox steps repeated across procedures are not reported unless a run of steps was copied; a sub-item under two different parent bullets is per parent at any length; one sentence shared by two different paragraphs is a note with its own message.
- `name-format` and `name-dir-mismatch`: `prefix:<folder>` in a plugin skill is a note (Claude Code keeps a name that already carries the plugin prefix, 2.1.246+); the folder is compared with the part after the prefix.
- `length`: a CLAUDE.md that is a symlink to an AGENTS.md reports its size as a note; the content is reported under AGENTS.md.
- `agents-md-shadowed`: files under `.agents/` are skipped, since Claude Code reads nothing there.
- `path-rule-matches-nothing` checks Copilot instructions only in `.github/instructions` (an instructions collection elsewhere was reported). `skill-description-overlap` skips a pair whose "do not use for" clauses name each other's distinguishing word, or where one description points to the other as a separate skill. Both came from the integration corpus run.
- npm description and keywords (see the root changelog).
- Dev dependencies: `@modelcontextprotocol/sdk` 1.32.1 and `zod` 4.6.7 (both bundled), `vitest` 5.0.5, `@types/node` 26.6.5.

### Fixed
- `broken-import` resolves an import the way the tool that loads it does. Claude Code 2.1.312 matches `(?:^|\s)@((?:[^\s\\]|\\ )+)` in markdown text, cuts the match at `#` and keeps any punctuation; Gemini CLI's `findImports` takes the word up to whitespace and keeps everything. So when the file exists but the word has a trailing `:`, `.`, `;` or `)`, or the `@` comes right after `(`, the import loads nothing and is now a warning that says why. Before, the punctuation was stripped and the import passed. A `#section` after a Claude Code import is no longer reported as a missing file. Canary runs in Claude Code confirmed each case: `@colon.md:`, `@period.md.`, `@semi.md;`, `(see @paren.md)` and `(@open.md)` did not load; `**@bold.md**`, `_@em.md_`, `@frag.md#setup` and a list item did.
- `broken-import` checks imports inside imported files. It walks them depth first, opens each file once and stops where the tool stops: 4 hops for Claude Code (`VENDOR.importMaxHops`; the canary chain loaded d1 to d4 and not d5) and 5 for Gemini CLI. A missing file, an import that loads nothing, or a file past the last hop is reported on the import in the linted file that starts the chain, with the chain in the message. A file cut off on one path but loaded through a shorter one is not reported. In imported files only paths that are surely files with a text extension Claude Code loads count; `@people`, `@scope/pkg`, images and template placeholders (`[name]`, `xxx`) are skipped. Imported CLAUDE.md, GEMINI.md and rule files are not followed, since they are linted on their own. At most 100 imported files are opened per linted file.
- `context_budget` lists an import that loads nothing as "not loaded as written" and does not count its tokens.
- `<!-->` and `<!--->` are complete, empty comments (CommonMark 0.31.2, 6.6). Every comment scanner looked for `-->` from four characters after `<!--`, so it missed the one that overlaps the opener and read the rest of the file as hidden ([#28](https://github.com/Katta041/asitis-agent-tools/issues/28)). Fixed in one place, `commentClose()` in `scan.ts`, used by `hidden-comment` and `hidden-instruction`, import detection, suppression comments, the budget's comment stripping and the `hidden-instruction` fix. Empty comments no longer count toward the `hidden-comment` note.
- `duplicate-rule` ran its placeholder regex once per copy of a rule. A 10 MB file of `[a` lines has millions of copies and took 2.9 s in `lint_steering`; the result is now cached per rule text and the check is skipped when there is no `]`. 1.3 s, byte-identical output.
- `broken-import`: `@<CONTEXT_DIR>/x.md`, `@{dir}/x.md` and possessives (`@babel/parser's`) are not imports.
- Fingerprints: each line is normalised and hashed once per rule (`FingerprintCounter` in findings.ts) instead of once per finding, twice. A 10 MB single-line file of ` @a` took 42 to 70 s in the CLI and now takes about a second. Fingerprints are byte-identical.
- Fix diffs no longer show a line that holds a key (#32). Edits whose hunk would show a key line, as a change or as context, are left out with a note; if none are left, no fix is offered and the finding says why. A last `findSecrets` pass over the rendered diff backs this up.

### Precision
I ran `asitis lint --include skills,config` over 80 public repos: the top results of a GitHub code search for CLAUDE.md files with `@` imports, GEMINI.md and SKILL.md files, plus ruff, cal.com, sentry-javascript, pydantic-ai and vercel/ai. Compared with 0.3.0, errors and warnings went from 220 to 227, nothing was removed, and all 7 new warnings are real when checked by hand (6 punctuation or `(` imports, 1 chained import that resolves against the wrong folder). The first version of the chain check also reported image paths and `[placeholder]` paths in imported docs (9 more); those are now skipped. The 7 new `xml-tag` notes are 5 placeholders and 2 element names (`<details>`, `<Link>`).

Each new rule was hand-labelled on its own corpus (numbers above). On the 71-repo release corpus (`tools/evalset`, every error and warning labelled), 0.3.0 had 900 errors and warnings at 70.3% precision and 0.4.0 has 655 at 91.3%. The 15 new ones are all labelled: 14 worth fixing and one committed `settings.local.json` that a cookbook ships on purpose; the rest of the change is false positives gone. Five PostHog broken links in skill `references/` files drop out because 0.3.0 hit the walk limit there and the corpus runner linted every file by name; a normal walk never lints those files, and passing them by name still reports all five. The synthetic evalset (165 cases) is 100% precision and recall.

### Tests
- `security-review.test.ts` failed about once in 60 runs. A fake key `Bearer B...` matched the correct output `Bearer Bearer [redacted, 16 chars]`. The leak check now leaves out the context words around a key (`Bearer `, the URL scheme and host), and the keys come from a seeded stream, so every run checks the same keys (`ASITIS_KEY_SEED` tries others). 150 seeds, 4 formats each, gave no false match.
- `dos.test.ts` retries a tool call once when it goes over the 3 s budget. A cold first read of a 10 MB file written a moment before (Windows Defender scans it) or a GC pause can cost a second once; a slow scanner is slow both times. The budget itself is unchanged.

## [0.3.0] - 2026-10-15

### Added
- `asitis` CLI, a second bin in this package: `npx -y -p @asitis/mcp@0.3.0 asitis lint`. `asitis lint [paths...]` lints the named files, or every steering file under `--root`, and exits 0 (clean), 1 (findings at or above `--fail-on`), 2 (something you can fix, one line on stderr) or 3 (a bug, one line with the issue link). Flags: `--format`, `--fail-on`, `--config`, `--baseline`, `--write-baseline`, `--include`, `--fix-preview[=safe]`, `--max-files`, `--max-file-mb`, `--quiet`, `--allow-broad-root`. `asitis budget [file]` prints the `context_budget` report as text or JSON. The full contract is in `docs/cli-contract.md`.
- Output formats: `text`, `json` (schema in `schema/report-1.json`), `sarif` (SARIF 2.1.0 with rule metadata, fingerprints, suppressions and fixes; each rule links to its page under `docs/rules/`) and `github` (workflow-command annotations, escaped so text from a file can never become a command). SARIF and GitHub paths are prefixed with a relative `--root`, so code scanning finds the file.
- `.asitisrc.json`: per-rule severity (`error`, `warning`, `note`, `off`), `length` thresholds, `ignore` and `overrides` globs, `include`, and `extends: "recommended" | "strict"`. Every mistake stops the run with the file, the line and a suggestion (`.asitisrc.json line 2: unknown key "rulez" (did you mean "rules"?)`). JSON schema in `schema/asitisrc-1.json`. The CLI honours `include` and `strict` from the file; the MCP server never lets a repo's config widen what it reads and says how to pass `include` instead.
- Inline suppression with a required rule id: `<!-- asitis-disable-next-line rule-id -- reason -->` and `<!-- asitis-disable-file rule-id -- reason -->`. Security rules cannot be suppressed by a comment. New rules `suppression-not-allowed`, `unknown-suppression` and `unused-suppression`.
- Baselines: `--baseline <file>` marks listed fingerprints as suppressed, and `--write-baseline` prints one. Fingerprints survive lines inserted above and CRLF/LF changes; a new copy of a baselined finding still fires.
- Drift checks on whole-folder lints: `agents-md-shadowed` (Claude Code skips an AGENTS.md when a CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md is in the folder or above and does not import it), `claude-local-hides-agents-md`, `agents-md-unread-variant` (AGENTS.override.md, AGENTS.local.md and .agents/ files), `cross-file-contradiction`, `instruction-drift` (mirrored files that share most rules but not all) and `codex-chain-over-budget` (Codex's 32 KiB is shared by every AGENTS.md from the root down). One cause that hits many files is one finding that names the rest. Skill folders, templates, examples and fixtures are left out.
- Skill folder scan, opt-in with `include: ["skills"]` or `--include skills`. It reads the scripts in each skill folder (up to 1 MB each) and only the first 4 bytes of other files, refuses `.env` and symlinks that leave the project, and runs nothing. Rules: `sec-remote-exec`, `sec-encoded-blob`, `sec-secret-egress`, `sec-skill-network`, `sec-skill-allowed-tools`, `sec-skill-binary`, `sec-safety-off`, `sec-skill-arg-injection` (a skill argument inside a `` !`command` ``, which Claude Code fills in before it runs the command), `sec-script-instruction` and `sec-script-invisible`. It also checks `.claude/commands/` and `.claude/agents/`. On 1,076 real skill folders it reported no false errors.
- Agent config audit, opt-in with `include: ["config"]`: `.claude/settings.json`, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` and `.gemini/settings.json` at the top of the root. `.claude/settings.local.json` is read only with `config-local`, and `~/.claude.json` is never read. Rules: `sec-hook-config`, `sec-permission-allow`, `sec-permission-mode`, `sec-no-secret-deny`, `sec-mcp-launcher`, `sec-mcp-inline-secret` and `config-json-invalid` (with line and column).
- `suggest_fixes` tool and `--fix-preview`: fixes as a unified diff that `git apply` takes, plus the old and new text for each edit. It never writes. Safe fixes for `invisible-char`, `trailing-whitespace`, `final-newline` and `frontmatter-not-line-1`; review fixes for `bidi-control`, `name-format`, `name-dir-mismatch`, `field-type`, `frontmatter-value-cut`, near-miss `unknown-key` and `hidden-instruction`. Diffs keep CRLF, mixed line endings, the BOM and a missing final newline as they are.
- Two note-level rules: `trailing-whitespace` (spaces or tabs at a line end that change nothing when rendered) and `final-newline`.
- A page for every active rule in `docs/rules/`, generated by `scripts/gen-rule-docs.mjs` from the registry and hand-written examples.

### Changed

- Invisible and bidirectional characters, and hidden comments that ask the agent to ignore instructions, hide something, run a command or reach for secrets, are now errors, so the default `--fail-on error` blocks them in CI. Hidden comments that only address the agent stay warnings.
- `lint_steering` takes `include` (`skills`, `config`, `config-local`). Without it the server reads markdown only, as in 0.2.5. It reads `.asitisrc.json` on every call, applies severities and suppressions, and counts suppressed findings instead of listing them.
- `lint_steering` on a whole folder can report the drift rules, so its output changes on repos that have them.
- A folder symlinked into the project (`.claude/skills -> ../.agents/skills`) is linted once, not twice. `context_budget` still counts what each agent loads from each folder.
- `xml-tag` reports only definite markup in a skill name or description: a closing tag, a self-closing tag or a tag with an attribute. All 5 hits in a 66-repo sample were placeholders such as `<number>`.
- Two inventory notes show only with `extends: strict`: plain hooks in `.claude/settings.json` and subagents with no `tools` list. Each fired on most repos that have hooks or subagents.
- The severity of dangerous hidden content (`invisible-char`, `bidi-control`, and `hidden-instruction` that asks to ignore instructions, hide something, act covertly, run a command or reach for secrets) is one constant, `DANGEROUS_HIDDEN_SEVERITY` in `src/rules/core.meta.ts`. It is still `warning`.

### Precision
Before release we ran the CLI with `--include skills,config` over 71 public repos and labelled every error and warning by hand. 59% were worth a contributor's time. After these changes it is 98% of 279 (the labels and the method are in the release PR), with every finding the review marked as real still reported.
- `duplicate-rule`: where the two copies sit decides what is reported. A repeat in one section, or in a block copied under the same heading, is a warning; a repeat under an unrelated heading (a summary and its detail) is a note; parallel sibling sections and labels (two procedures, two variants, Phase 1 and Phase 3) share steps without a finding. Template lines that are mostly `[placeholders]` are skipped, a paragraph gives one finding, and an AGENTS.md inside a skill, template or example folder is not checked. On the 71 repos: 93 warnings, 9 of them real, became 7 warnings, all real.
- `length`: a CLAUDE.md of 201 to 300 lines is a note, the warning starts above 300. AGENTS.md and CLAUDE.md files in skill, template, example and fixture folders are skipped, since Codex never starts there.
- `body-tokens`: a note from 5,000 to 6,000 tokens, a warning above. When the SKILL.md is also over 500 lines, this one finding gives both counts instead of a second `length` finding.
- `duplicate-across-files` ignores bold-only label lines (`**Impact: HIGH**`) and lines that are only a link or a "Reference:" pointer.
- `agents-md-shadowed` no longer tells you to import an AGENTS.md that the CLAUDE.md beside it nearly copies (more than 90% of lines match), since that would load the text twice. `instruction-drift` reports that pair with the advice to replace CLAUDE.md with `@AGENTS.md` or a symlink. `instruction-drift` is now one note per file with a count and three examples, and stays quiet for a pair `agents-md-shadowed` already reports.
- `name-dir-mismatch` checks only skills that sit directly in a skills folder, and skips `template/` folders. Skill format rules skip SKILL.md files under tests, fixtures and testdata folders. `name-reserved-word` is a note: only claude.ai and API uploads reject the name.
- `hidden-instruction` leaves machine-readable directive comments such as `<!-- agents:cwd=root -->` to the `hidden-comment` note, unless they ask for something harmful.
- `broken-link`: a path that resolves from the repository root but not from the file is a note; single-word targets such as `[Smith et al.](url)` are skipped; links into a git submodule listed in `.gitmodules` count as present; anchors match with emoji variation selectors removed.
- `broken-import` skips `@scope/name` in headings and `@name` inside double quotes, and never takes a closing quote or punctuation into the token.
- `unknown-key` escalates a near miss to a warning only when the value is the kind the real key takes (a list under `modes:` is not a misspelt `model:`). In a SKILL.md the note says claude.ai and the Claude API reject keys outside the spec and suggests `metadata:`.
- Skill scan: in a reference page, attack examples in code under a "Patterns" or "Examples" heading are notes (a security skill documenting what it detects); a scanner script's regex pattern list is not `sec-script-instruction`; `sec-safety-off` is one finding per skill and flag, on the code if there is one; a download piped to a shell from the project's own repository or homepage is a warning, not an error.
- `sec-mcp-launcher` skips the repository's own published MCP server (matched by the root folder name or the root `package.json` or `pyproject.toml` name). With `include: ["config"]` those two manifests are read for their name and URLs only.
- With `--format github`, notes are no longer annotations unless you pass `--annotate-notes` (the Action has an `annotate-notes` input). They still count in the summary line, which says how many were left out.
- A CLAUDE.md that is a symlink to AGENTS.md no longer repeats every finding under both names.
- Messages: `hidden-comment` quotes the first comment and says what to check, `context-cost` says what to move, `final-newline` no longer claims agents append to files, `sec-skill-allowed-tools` says the grant lasts for the turn that invokes the skill, and the note for findings past the per-file cap gives a count.
- CLI: `asitis lint --help` and `asitis budget --help` print that command's options; an empty path, an absolute path outside the current folder and a named `.mcp.json` without `--include config` each get a clear one-line error; the config scan says which files it read; `asitis disable-next-line` and other misspelt directives are reported with the spelling they need.
- Rule pages: the README index and each page say when a rule's severity depends on where it fires, and the `trailing-whitespace`, `sec-remote-exec` and `sec-skill-allowed-tools` pages match the code.

### Security

- A repo's own `.asitisrc.json` or baseline can no longer hide a security finding without saying so. `lint_steering` ignores rules turned off, lowered or ignored for security rules unless the call passes `trustRepoConfig: true`. The CLI and the Action still apply the config, but every hidden security finding stays in JSON and SARIF as a suppressed result with a justification, and one line counts them (also with `--quiet`). New CLI flag `--fail-on-hidden-security`; the Action's new input `fail-on-hidden-security` is on by default.
- An `ignore` pattern no longer drops the security findings of a file it matches.
- Redaction now masks credentials by position (URL passwords, `Authorization:` and key headers, `--token`, `key=` and the like), more key shapes (GitLab, Hugging Face, SendGrid, JWT, Slack webhooks, PEM headers) and random-looking words, before any quote is cut. Generic masks show only the length. Every message and notice gets a second pass. On the review's fixtures 35 of 36 fake keys showed up, at least in part, in each of text, JSON, SARIF, GitHub and `lint_steering` output; now none do. Fix diffs still show the lines they change, keys included, as they must for `git apply`.
- `.claude.json` is refused as a `--config` or `--baseline` file, also through a symlink, and config and baseline errors no longer echo a value or key that could be a password or token.
- Text output quotes a path that starts with a space, `:` or `#`, so a file name cannot start a workflow command in a CI log. `lint_steering` quotes any file name with spaces or punctuation, so a name cannot read as the tool's own report text.
- Fix diffs quote a path with a space, so `diff --git a/x.md b/CLAUDE.md ...` can no longer be read as a different file.

### Fixed
- `invisible-char` no longer fires on characters that are part of the writing: ZWNJ in Persian, ZWJ in Hindi conjuncts, LRM and RLM on right-to-left lines, emoji joiners, and the tag characters of a subdivision flag (England, Scotland, Wales). A tag run that spells more than a flag is still reported.
- Linting a file with many comment lines and no backticks was quadratic (a 10 MB file of one-line comments took over 20 seconds). The inline code span check now looks at one line at a time.
- A file whose lint threw an error after it was read could leave cross-file checks matching findings to the wrong file.
- A folder the walk cannot read (permission denied) is reported: exit 2 in the CLI, a note in `lint_steering` and `find_steering_files`. Other read errors are exit 3 instead of a clean result. A deleted current folder is one line and exit 2.
- The baseline fingerprint of `codex-chain-over-budget` hashes the chain of AGENTS.md files instead of the cut line, so CRLF or an edit above the cut no longer makes it a new finding.
- `suggest_fixes` and `--fix-preview` offer no fix with more than 200,000 edits in one file (trailing spaces on millions of lines). Such a file took 54 s and 3.5 GB in `suggest_fixes`, and crashed `--fix-preview --format json`; it now takes about 1.3 s and says why there is no fix.
- SARIF rules carry a `help` object (text and markdown), which GitHub code scanning asks for (GH2012).
- CLI messages: no `<path>` placeholder or "this server" wording, and a refused `.mcp.json` or settings file points to `--include config`. The summary reads `no issues found, N suppressed.` as the contract says.
- Action: the SARIF upload runs with `continue-on-error`, so a 403 on a private repo without Code Security no longer turns a clean lint red; `paths` takes a path with spaces on its own line or alone; an absolute `root` inside the workspace is made relative.
- Docs: lefthook needs `glob_matcher: doublestar` to lint root files; the husky and lefthook lists match the pre-commit hook; husky keeps renamed files (`ACMR`) and file names with spaces; SHA pinning uses the peeled tag (`^{}`); `pre-commit try-repo` gets `--ref`; code scanning needs a public repo or Code Security; GitHub shows at most 10 annotations of each type per step.

## [0.2.5] - 2026-10-14

### Changed
- Results are text only by default. Claude Code 2.1 gives the model `structuredContent` instead of the text when both are present, which dropped the untrusted-content notice, the escaping and `read_markdown`'s file text, and made results two to five times larger. `--structured` or `ASITIS_MCP_STRUCTURED=1` adds the JSON back for scripts.
- The asitis.app line is off by default. `--footer` (or `--footer true`) or `ASITIS_MCP_FOOTER=1` turns it on, once per session as before. `--no-footer` and `--footer false` are still accepted and win over the variable.
- `context_budget`, Claude Code: with a CLAUDE.md, AGENTS.md counts only when CLAUDE.md `@`-imports it, and a note says "Claude Code ignores AGENTS.md here" when it does not; with no CLAUDE.md, AGENTS.md and its imports are counted (Claude Code 2.1.277 and later; checked with canary files on 2.1.299). Lint checks AGENTS.md imports in that second case only.
- `context_budget`: nested `.windsurfrules` and nested always-apply Cursor rules are on demand, not every session; Cline rules with `paths` load on match, `paths: []` never, and `.clinerules/workflows/*.md` on invocation; `.claude/CLAUDE.local.md` is not a location Claude Code reads; MEMORY.md counts for Claude Code only from a memory folder (a second `--root`, or `.claude/projects/<project>/memory/`); Gemini CLI imports are followed 5 levels deep; nested skills and nested commands or subagents get separate, accurate notes; an unclosed comment no longer hides the rest of CLAUDE.md from the count. The CLAUDE.md entry says why the whole file is larger (block comments are stripped), and a missing `@import` prints a warning with the importing file and line.
- Symlinks that resolve inside a root are followed by the folder walk, each real folder once. A file reached through one is classified by the path the agent sees and shown as `CLAUDE.md (symlink to AGENTS.md)`.
- Result sizes: `read_markdown` returns 32 KiB by default (about 8k tokens); `outline` lists 400 headings per call and takes `offset`; `find_steering_files` and `context_budget` list at most 60 files per group and give the full counts; `lint_steering` lists at most 300 findings, says "Linted 300 of 1,602 steering files found" with how to lint the rest, and says when the walk stopped for depth, size or time. More than 200 imports are named as "At least N more imports", not counted, and flagged.
- Cursor rule types use Cursor's current names (Always Apply, Apply to Specific Files, Apply Intelligently, Apply Manually).

### Fixed
- `duplicate-rule`: a short list item repeated under another heading or parent bullet is reported when it reads as an instruction: it starts with a verb such as use, run, keep, add or avoid, says always, never, don't, must or should, or holds a command in backticks (`pnpm test`). Labels such as "Quality checklist", "Commit messages", "**Commands**" or "Run the tests:" are still skipped, and so is the same item under two different parent bullets (a per-parent checklist). Lines up to 2,000 characters are compared (was 400), a leading "a", "an" or "the" is ignored, and copies under different headings say they may be deliberate alternatives.
- `contradiction`: "Use X" against "Never use X" or "Don't use X", "Always X" against "Never X", "Do X" against "Do not X", "must" against "must not" and "Prefer X" against "Avoid X" are matched after ignoring case, backticks, emphasis and punctuation, anywhere in the file. The finding is on the later line and quotes both: `Contradicts line 10: line 10 says "Use named exports" and line 11 says "Never use named exports"`. An item under a heading, parent bullet or lead-in about things to avoid (Don'ts, Avoid, Anti-patterns, Bad, Pitfalls) is not read as a "do" rule.
- `broken-link`: `#anchor` links are checked against the headings of the file (GitHub slugs, repeated headings, `{#id}` and HTML `id`/`name`), also in other markdown files. Placeholders such as `[Title](URL)` and `${GITHUB_SERVER_URL}/...` are skipped.
- Encodings: `invalid-utf8` is reported on the line with the bad byte and suggests Latin-1 or Windows-1252; UTF-16 without a BOM is recognised; UTF-16 files no longer get a "may be a binary file" warning.
- `frontmatter-yaml`: Cursor's unquoted `globs: *.ts,*.tsx` is accepted in `.mdc` rules, so the rule also loads on match instead of manual-only. The message names the tool that reads the file and no longer claims a specific Claude Code behaviour.
- `hidden-instruction`: a secret word alone ("token", "SSH") or "Important:" or "Rule:" no longer makes a maintainer note an instruction; a request to send, print or upload secrets or `.env` does. "Agent:", "AI,", "Bot,", "Assistant must", "Model note" and more assistant names (Kiro, Windsurf, Cline, Aider, Devin, Junie) count as addressing the AI, and "ignore previous instructions" is recognised in Spanish, German, French, Chinese and Japanese.
- `hidden-styled-text`: `display:none` inside inline code is not flagged; a `hidden` attribute on the second line of a tag is.
- `invisible-char`: a ZERO WIDTH JOINER inside an emoji sequence is not flagged; runs of variation selectors, or one after an ordinary character (U+E0100 block), are.
- `broken-import`: an `@name` inside an HTML comment is not an import (Claude Code strips those comments).
- `hidden-comment`: the note points at the first plain comment, including a `[//]: #` comment.
- `duplicate-across-files`: only files that the same tool loads in the same session are compared (CLAUDE.md, its imports and always-on rules for Claude Code; always-apply Cursor rules; and so on), and the message names that tool.
- Vendor docs, rechecked on 2026-10-14: skill booleans accept `yes`, `no`, `on`, `off`, `1` and `0`; `description` on `.claude/rules`, `name` and `paths` on commands, and `version` on skills are reported as ignored; a memory file without a description is a note, not a warning; the missing-description message says Claude Code uses the first non-empty line; a skill name with non-ASCII lowercase letters is a warning (the spec allows it, the Claude API does not); `missing-applyTo` fires only when `description` is missing too; the Codex length advice says the 32 KiB is shared by every AGENTS.md and no longer suggests nested files.
- New: `frontmatter-value-cut` warns when an unquoted ` #` cuts a value short (`description: Use for A #1 and B`), and `unknown-key` is a warning with a suggestion when the key is one or two letters from a known key (`user-invokable`: did you mean `user-invocable`?).
- Protocol: bad JSON gets a -32700 response, a batch or a malformed request -32600, an unknown tool or wrong parameters -32602 with a one-line message. A message over the 10 MB read buffer ends the session with one line on stderr and exit code 1. Filesystem errors say "Permission denied" or "Symlink loop", and internal errors have absolute paths removed. At most 4 tool calls run at once and 32 wait; more get a "Busy" result.
- Folder walk: a `.claude/projects/<project>/memory` fixture replaces the old top-level `memory/` in the tests, and a `memory` folder deep in a source tree (for example `src/lib/memory/README.md`) is no longer treated as Claude memory.

On the pinned sample of 200 public AGENTS.md and CLAUDE.md files, `duplicate-rule` goes from 4 to 5 findings (the new one is a real repeat in strapi/strapi), `contradiction` stays at 0, and `broken-import` gains 4 findings in one AGENTS.md (it has no CLAUDE.md beside it in the sample, so its `@path` imports are now checked, and the linked files were not part of the sample). No other rule changes.

## [0.2.4] - 2026-10-14

### Changed
- npm and MCP Registry listings link to https://asitis.app/claude-code instead of the home page.
- A test fails the release if a README pins `@asitis/mcp` at any version other than the package's own.
- Tool output is easier to read for people and models. Findings read `- line 12 [warning] rule: message`, sorted errors first; files with errors come first and clean files share one closing line. `outline` prints `line 7: # "Title"`, indented by level, instead of `L7  # "Title"`, which lost its spacing when copied. Plurals are correct ("1 file", not "1 file(s)"), numbers have thousands separators, and "about 10.0k tokens" is now "about 10k tokens".
- `context_budget` lists tools by name (Claude Code, Codex, Gemini CLI) and largest first, opens with a one-line total per tool, and says why an import was not counted instead of "about 0 tokens".
- `find_steering_files` says a note shared by every skill once instead of on each line, and ends with what to run next.
- `read_markdown` describes the file in one sentence ("File: 32 bytes, 3 lines, UTF-8, LF line endings, final newline, no trailing whitespace.") instead of a row of `|` fields.
- Lint messages say what to do: fix or remove a broken link or import, keep one of two duplicate or contradictory rules (now quoted), delete an invisible character, and a valid skill name to use for `name-format`. `field-type` no longer double-quotes a string value (`not "yes"`, was `not "\"yes\""`).
- The asitis.app line is shown once per session, on the first successful result, and never on an error. The untrusted-data notice is shorter. Errors for a missing file point to `find_steering_files`; size errors read "4,096 bytes" or "17.2 MB".

## [0.2.3] - 2026-10-14

### Fixed
- Windows: reads no longer fail with "is a symlink that resolves outside the allowed folder" when the root is given as an 8.3 short path (`C:\Users\RUNNER~1\...`) or in a different case. Since 0.2.0 the root was resolved with the JavaScript `fs.realpathSync`, which keeps the spelling it is given, while files were resolved with the native `fs.promises.realpath`, which returns long names in their on-disk case, so a file inside the root looked outside it. The root is now also resolved with `fs.realpathSync.native`, and containment is checked against that form (case-insensitively on Windows). Paths are still opened under the root as given, because Node's permission model compares `--allow-fs-read` folders as plain, case-sensitive strings and does not expand short names. Confinement is unchanged: links that resolve outside the root, `.env` files and `.claude/settings*.json` are still refused. A case-varied root on macOS had the same problem.
- An absolute path to a file inside the root is accepted in any of the root's spellings (as given, in another case, or the long form) and is opened under the root as given.

### Changed
- npm `description` and `keywords` rewritten for search: the description names the files checked (CLAUDE.md, AGENTS.md, SKILL.md, Cursor rules) and stays under 160 characters; 20 keywords.

### Tests
- New `root-forms` tests run every confinement check with the root given as an 8.3 short path (from `cmd`'s `%~s`) and as a case-varied path, in process and under `--permission` with only that form granted.

## [0.2.2] - 2026-10-14

### Added
- Official MCP Registry metadata: `mcpName` (`io.github.Katta041/asitis-mcp`) in `package.json` and a `server.json` that describes the npm package, its stdio transport and the `--root` argument. No change to the server itself.

### Fixed
- The guard hook test that checks the fail-closed time budget no longer depends on machine speed. It lowers the budget through `ASITIS_GUARD_BUDGET_MS` instead of timing a large MultiEdit against the clock.
- The copy-rules test scans only files tracked by git, so a local `npm pack` tarball or build output is never reported as authored copy.

## [0.2.1] - 2026-10-13

### Fixed
- `hidden-instruction` no longer fires on a product name alone, such as a comment saying a file was made with Claude Code, or "claude" inside a URL. A comment must speak to the assistant: by name followed by a comma or colon ("Claude, ..."), with the name as the subject of a directive ("Copilot should ..."), or with the existing cues ("ignore previous instructions", "you must", "note to the AI:"). URLs are ignored when classifying. ([#2](https://github.com/Katta041/asitis-agent-tools/issues/2))
- `duplicate-rule` compares whole list items and whole sentences, with wrapped lines joined first, instead of single lines. Markup-only lines such as `</details>`, short labels such as "Code comments:", and short emphasis sentences such as "No exceptions." are not rules. On a sample of 200 public CLAUDE.md and AGENTS.md files this removes all 5 noisy findings and keeps the 4 real duplicates. ([#3](https://github.com/Katta041/asitis-agent-tools/issues/3))

## [0.2.0] - 2026-10-03

### Fixed
- The server starts when Node's permission model denies `realpath` on the root (it falls back to the lexical path), and a root that Node will not let it read gets a one-line explanation naming the nested `--allow-fs-read` folder, instead of "Root folder not found" or a raw Node error. Root checks use the sync fs API, which fails cleanly on Node 22.13.
- `outline` keeps the first heading of files with a BOM. YAML errors are reported on their real line.
- `context_budget` counts only skills, commands and subagents that Claude Code loads from `.claude/`.

### Security
- Every tool quotes and escapes text from files (keys, values, headings, link targets, file names, error messages) and marks it as untrusted, so a repository cannot forge report lines. New `unsafe-path` warning.
- `[//]: # (...)` comments and the HTML `hidden` attribute are reported as hidden content.

### Added
- Lint: `name-reserved-word`, `xml-tag` and `body-tokens`; `description-too-long` is now an error.

### Changed
- Fewer false positives: bold labels and short list items in other sections, comments in inline code, npm package names after `@`.

## [0.1.0] - 2026-10-01

### Added
- Stdio MCP server with five read-only tools: `read_markdown` (byte-faithful text plus encoding, BOM, line-ending, trailing-whitespace and invalid UTF-8 profile, paging, base64 mode), `outline`, `lint_steering`, `context_budget` and `find_steering_files`.
- Steering-file lint: frontmatter line-1 rule and YAML parse, required SKILL.md and subagent fields, unknown keys, vendor length limits, broken relative links and `@imports`, invisible and bidirectional characters, hidden instruction comments, hidden styled text, duplicate and contradictory-looking rules, orphaned memory files.
- Root confinement with realpath checks, markdown-only allowlist, hard deny for `.env*`, `.claude/settings*.json`, `.git/` and `node_modules/`, size caps, per-call time budget and linear-time scanners.
- One-file bundle with zero runtime dependencies and third-party notices.
- One footer line per result pointing to asitis.app, with `--no-footer` to turn it off.
- Released under the MIT licence.

### Security
- Regression tests for path traversal, symlink file and folder escape, settings and `.env` access, and 10 MB denial-of-service inputs.
- There is no write, patch or delete tool.

[0.2.5]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Katta041/asitis-agent-tools/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Katta041/asitis-agent-tools/compare/12b43a6...v0.2.0
[0.1.0]: https://github.com/Katta041/asitis-agent-tools/commit/12b43a6

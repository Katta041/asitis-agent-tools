# asitis CLI contract (0.3.0)

This is the fixed contract for the `asitis` command, its output formats and the code seams behind them. The CLI (WP1), the GitHub Action and pre-commit hook (WP3), config and baseline (WP2) and fixes (WP7) build against it. If something here is wrong or missing, ask the WP0 owner to change this file; do not work around it in a track.

Types named here live in `packages/mcp/src/findings.ts` and `packages/mcp/src/project.ts`.

## Binary

- A second bin, `asitis`, in `@asitis/mcp`: `"bin": { "asitis-mcp": "dist/asitis-mcp.mjs", "asitis": "dist/asitis.mjs" }`.
- Entry: `packages/mcp/src/cli/asitis.ts`. Built by `scripts/build.mjs` as a second bundle, `dist/asitis.mjs`, with the same banner, target and minify settings as the server bundle.
- Copies, each pinned by SHA-256 in a `VERSION` file next to it: `plugins/asitis/server/asitis.mjs` and `action/asitis.mjs`. `npm run sync-plugin` writes all three; CI checks all three pins.
- Run without installing: `npx -y -p @asitis/mcp@0.3.0 asitis lint`.
- `asitis-mcp` does not get a `lint` subcommand. It treats positionals as root folders and that stays.
- The bundle follows the server's rules: no write, exec or network code, no `child_process`, `net`, `http`, `https`, `http2`, `dns`, `tls`, `dgram`, `worker_threads` or `cluster`. It may import the Node modules the server bundle already imports (`node:fs`, `node:path`, `node:crypto`, `node:os`, `node:util`, `node:process`) and nothing else. Output goes to stdout and stderr only; files come from shell redirects.

### `@asitis/cli` (not in 0.3.0; planned for 0.3.x)

A thin package so `npm search` finds the linter under its own name:

- `packages/cli/package.json`: `"name": "@asitis/cli"`, `"bin": { "asitis": "bin/asitis.mjs" }`, one dependency, `"@asitis/mcp": "<exact version>"`, no install scripts.
- `bin/asitis.mjs` is two lines: a shebang and `import "@asitis/mcp/dist/asitis.mjs";`. `@asitis/mcp` has no `exports` field, so the deep import resolves. If one is ever added, it must export `./dist/asitis.mjs`.
- Versions move together with `@asitis/mcp`; the version test covers both.

## Usage

```
asitis lint [paths...] [--root <dir>] [--format text|json|sarif|github]
            [--fail-on error|warning|note|never] [--config <file>]
            [--baseline <file>] [--write-baseline] [--include <list>]
            [--fix-preview[=safe]] [--max-files <n>] [--max-file-mb <n>] [--quiet]
            [--annotate-notes]
asitis budget [file] [--root <dir>] [--format text|json] [--max-file-mb <n>]
asitis --version
asitis --help
asitis lint --help | asitis budget --help
```

| Flag | Default | Meaning |
|---|---|---|
| `paths...` | none | Files to lint. Relative paths resolve against the current folder and must be inside the root. With no paths, every steering file under the root is linted (up to `CAPS.walkMaxFiles`, 1,000). Pre-commit passes the changed files here. |
| `--root <dir>` | current folder | The one folder the CLI may read. Same confinement as the server: symlinks out of it, `.env*`, `.git`, `node_modules` and (unless `--include config`) settings files are refused. Home folder and filesystem root are refused unless `--allow-broad-root` is given. Only one `--root`. |
| `--format` | `text` | Output format, below. |
| `--fail-on` | `error` | Lowest severity that makes the exit code 1. `never` always exits 0 when the run itself worked. |
| `--config <file>` | `<root>/.asitisrc.json` if present | Config file. Must be inside the root. A missing default file is fine; a missing `--config` file is exit 2. |
| `--baseline <file>` | none | Findings whose fingerprint is listed are marked suppressed (`kind: "external"`). Must be inside the root. |
| `--write-baseline` | off | Print a baseline for the current findings instead of the report. Needs `--format json`; any other format is exit 2. |
| `--include <list>` | none | Comma-separated opt-in scans: `skills`, `config`, `config-local` (implies `config`). Unknown values are exit 2. Merged with `include` from the config file. |
| `--fix-preview[=safe]` | off | Attach fixes. With `text` it prints one combined unified diff that `git apply` accepts, and nothing else. With `json` each fixable finding gets `fix`; with `sarif` results get `fixes[]`; with `github` it is ignored. `=safe` limits fixes to safe ones. There is no flag that writes. |
| `--max-files <n>` | 1,000 | Most steering files linted when walking the root, 1 to 1,000 (`CAPS.walkMaxFiles`). A walk that finds more is exit 2. |
| `--max-file-mb <n>` | 16 | Largest markdown file analysed, 1 to 64. |
| `--quiet` | off | `text` and `github` only: no summary line, no notices. Findings are still printed. |
| `--annotate-notes` | off | `github` only (any other format is exit 2): also annotate findings of severity note. Without it only errors and warnings become annotations; notes still count in the summary line, and one more line says how many were left out. |
| `--allow-broad-root` | off | As in `asitis-mcp`. |

`ASITIS_DEBUG=1` adds a stack trace to exit code 3. No other environment variable changes behaviour.

Unknown flags, a flag without its value, a bad enum value and a bad number are all exit 2.

## Exit codes

| Code | When | Output |
|---|---|---|
| 0 | The run worked and no unsuppressed finding is at or above `--fail-on`. | The report. |
| 1 | The run worked and at least one unsuppressed finding is at or above `--fail-on`. | The report. |
| 2 | Something the user can fix: an unknown flag or value, a path that does not exist or is outside the root or refused, an unreadable or invalid config or baseline, Node older than 22.13, or a run cut short by the file or time limit. | One line on stderr, starting `asitis: `, no stack trace. Nothing on stdout. |
| 3 | A bug in asitis. | One line on stderr: `asitis: internal error in asitis <version>: <message without absolute paths>. Please report it at https://github.com/Katta041/asitis-agent-tools/issues`. Stack only with `ASITIS_DEBUG=1`. |

Precedence: 3 over 2 over 1 over 0.

Examples of exit 2 lines:

```
asitis: .asitisrc.json line 3: unknown key "rulez" (did you mean "rules"?)
asitis: docs/missing.md: file not found
asitis: --fail-on must be error, warning, note or never, not "warn"
asitis: Node 22.13 or later is needed (this is 20.11.0)
asitis: stopped after 1,000 steering files; pass paths to lint the rest
```

In code: `UserError` (from `paths.ts`) becomes exit 2 with its message; any other exception becomes exit 3. A file that was found by the walk but could not be read is a line on stderr (`asitis: <path>: not linted (<reason>)`) and does not change the exit code. A path the user named that cannot be read is exit 2.

The CLI runs with a deadline of 5 minutes (`new Deadline(300_000)`). If `project.timedOut` is true, or the walk was cut by the file, entry or time limit, the exit code is 2 with the "stopped after" line, because a partial lint must never look like a clean one.

The depth limit is the exception. Folders more than `CAPS.walkMaxDepth` levels deep are skipped the same way on every run (big monorepos such as next.js and vscode always reach it), so a walk cut only by depth is a notice, not exit 2: `Folders more than N levels deep were not searched; pass their files as paths to lint them.` The CLI decides this from `project.cut` (`{ depth, size, time }`), never by matching the text of `walkNote`.

## Code path

```ts
const sandbox = await Sandbox.create([root], { allowBroadRoot, maxFileBytes });
const project = await lintProject(sandbox, {
  targets,                    // [] for the whole folder
  include,                    // from --include
  configInclude: true,        // CLI only: include and extends from .asitisrc.json apply
  deadline: new Deadline(300_000),
  maxFiles,                   // --max-files, default CAPS.walkMaxFiles
  configPath, baselinePath,   // only when given
});
if (fixPreview && format !== "text") attachFixes(project, safety);  // fix.ts, before findings()
const findings = project.findings();          // sorted, fingerprinted, computed once
const report = buildReport(rootAsGiven, project.results.length, findings);
```

For `--fix-preview` with `text`, print `fixPreview(project, safety)` from `fix.ts` instead of the report.

`configInclude: true` is what makes `include` and `extends: strict` in `.asitisrc.json` widen what the CLI reads. The MCP server never passes it: there a repo's config can change severities and turn rules off, but it cannot make the server read skill scripts or settings files. If the config asks for a scan the call did not, `lint_steering` says so in a note (`.asitisrc.json asks for the config scan; pass include to lint_steering to run it.`) and reads nothing extra.

## Budget

`asitis budget [file]` prints what each agent loads at the start of every session, the same report as the MCP `context_budget` tool: per agent (Claude Code, Codex, Gemini CLI, Cursor, Copilot) a total and one line per file, largest agent first. With a file, it counts that file and its imports only. `--format json` prints the structured report. Token counts are local estimates. It exits 0 when the count ran, and 2 for the usual user errors; it has no `--fail-on`. A walk cut short prints the reason on stderr (`asitis: <reason>; the totals above may be low`).

`project.notes` are one-line notices (for example an `include` value that is not available yet). Print them to stderr for `json` and `sarif`, after the summary for `text`, and as `::notice::` lines for `github`.

## Findings

```ts
interface Finding {
  ruleId: string;
  severity: "error" | "warning" | "note";
  category: "format" | "budget" | "security" | "drift" | "config";
  path: string;        // root-relative, POSIX separators
  line: number;        // 1-based
  column: number;      // 1-based, UTF-16 code units
  endLine: number;
  endColumn: number;   // exclusive, as in SARIF
  message: string;     // plain text, may quote file content (already escaped and redacted)
  fingerprint?: string; // always set by lintProject
  suppressed?: { kind: "inSource" | "external"; justification?: string };
  fix?: { safety: "safe" | "review"; diff: string; edits: Array<{ startByte: number; endByte: number; replacement: string }> };
}
```

- Most rules report a line, not a span. Then `column` is 1 and `endColumn` is the line length plus 1, so the region is the whole line.
- Order: path, line, column, severity (error, warning, note), rule id. `compareFindings` in `findings.ts`.
- Internally `lint.ts` uses `info`. The CLI formats (text, json, sarif, github) say `note`. The MCP `lint_steering` tool's structured output (`--structured`) keeps `info`, as it did in 0.2.x, so existing callers keep working; its text output says `note`.

### Fingerprints

`sha256(ruleId + "\0" + path + "\0" + normalisedLineText + "\0" + occurrence)`, hex.

- `normalisedLineText`: the text of `line` with CR and LF removed, whitespace runs collapsed to one space, ends trimmed (`normaliseLineText`). Identical under CRLF and LF, and stable when lines are inserted above.
- `occurrence`: 0 for the first finding of that rule on that exact normalised text in that file, 1 for the next. A new copy of a baselined line therefore gets a new fingerprint and still fires.
- SARIF key: `partialFingerprints["asitis/v1"]`. If the recipe ever changes, the key becomes `asitis/v2`.

## Text format

```
CLAUDE.md:12:1 warning duplicate-rule Same rule as line 4: "Run the tests". Duplicates cost context ...
.claude/skills/x/SKILL.md:1:1 error missing-name name is required by the Agent Skills spec ...

Linted 12 files: 1 error, 3 warnings, 2 notes, 4 suppressed.
```

- One line per unsuppressed finding: `path:line:col severity rule-id message`. Control and bidi characters in path and message are escaped with `esc()` from `escape.js`, so one finding is always one line.
- A blank line, then the summary. The summary uses the wording of the MCP tool (`Linted N files: ...`) and adds `, N suppressed` only when N is above 0. With no findings: `Linted N files: no issues found.`
- Suppressed findings are not listed.

## JSON format

`JSON.stringify(report, null, 2) + "\n"`, where `report` is a `LintReport`:

```ts
interface LintReport {
  schemaVersion: 1;
  tool: { name: "asitis"; version: string };
  root: string;    // --root as given (default "."), backslashes turned into slashes; never made absolute
  summary: { files: number; errors: number; warnings: number; notes: number; suppressed: number };
  findings: Finding[];  // suppressed ones included, marked
}
```

- `schemaVersion` stays 1 for all of 0.x. Fields are only added, never renamed or removed; consumers must ignore unknown fields.
- `summary.errors`, `warnings` and `notes` count unsuppressed findings only.

JSON Schema (draft 2020-12), to be vendored as `packages/mcp/schema/report-1.json` by WP1:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://asitis.app/schema/report-1.json",
  "type": "object",
  "required": ["schemaVersion", "tool", "root", "summary", "findings"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "tool": {
      "type": "object",
      "required": ["name", "version"],
      "properties": { "name": { "const": "asitis" }, "version": { "type": "string" } }
    },
    "root": { "type": "string" },
    "summary": {
      "type": "object",
      "required": ["files", "errors", "warnings", "notes", "suppressed"],
      "properties": {
        "files": { "type": "integer", "minimum": 0 },
        "errors": { "type": "integer", "minimum": 0 },
        "warnings": { "type": "integer", "minimum": 0 },
        "notes": { "type": "integer", "minimum": 0 },
        "suppressed": { "type": "integer", "minimum": 0 }
      }
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["ruleId", "severity", "category", "path", "line", "column", "endLine", "endColumn", "message", "fingerprint"],
        "properties": {
          "ruleId": { "type": "string", "pattern": "^[a-z][A-Za-z0-9-]*$" },
          "severity": { "enum": ["error", "warning", "note"] },
          "category": { "enum": ["format", "budget", "security", "drift", "config"] },
          "path": { "type": "string" },
          "line": { "type": "integer", "minimum": 1 },
          "column": { "type": "integer", "minimum": 1 },
          "endLine": { "type": "integer", "minimum": 1 },
          "endColumn": { "type": "integer", "minimum": 1 },
          "message": { "type": "string" },
          "fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "suppressed": {
            "type": "object",
            "required": ["kind"],
            "properties": { "kind": { "enum": ["inSource", "external"] }, "justification": { "type": "string" } }
          },
          "fix": {
            "type": "object",
            "required": ["safety", "diff", "edits"],
            "properties": {
              "safety": { "enum": ["safe", "review"] },
              "diff": { "type": "string" },
              "edits": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["startByte", "endByte", "replacement"],
                  "properties": {
                    "startByte": { "type": "integer", "minimum": 0 },
                    "endByte": { "type": "integer", "minimum": 0 },
                    "replacement": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### Baseline file

`asitis lint --format json --write-baseline > .asitis-baseline.json` prints:

```json
{
  "schemaVersion": 1,
  "fingerprints": ["0a1b...", "..."]
}
```

Fingerprints of every finding that is not already suppressed, sorted, without duplicates (`baselineOf` in `baseline.ts`). Exit code is 0 whenever the baseline was written. The baseline is read through the `asitisrc` read class; WP2's policy decides its size limit with `maxBytesFor`.

## SARIF format

SARIF 2.1.0, one run, `JSON.stringify(log, null, 2) + "\n"`.

- `$schema`: `https://json.schemastore.org/sarif-2.1.0.json`, `version: "2.1.0"`.
- `runs[0].tool.driver`: `name: "AsItIs"`, `version`, `informationUri: "https://asitis.app"`, `rules[]`.
- `rules[]`: every rule from `activeRules()` in `rules/registry.ts`, in registry order. Planned rules are never listed. Each rule:
  - `id`
  - `shortDescription.text`: `summary`
  - `fullDescription.text`: `why`
  - `helpUri`: `https://github.com/Katta041/asitis-agent-tools/blob/main/docs/rules/<id>.md`, the page `gen-rule-docs.mjs` writes (`RULE_DOCS` in `format/sarif.ts`, `SITE` in the generator; a test keeps them equal)
  - `defaultConfiguration.level`: `defaultSeverity` (`error`, `warning`, `note` map one to one)
  - `properties.tags`: by category. `security` gives `["security"]`, `format` gives `["steering"]`, `budget` gives `["budget"]`, `drift` gives `["drift"]`, `config` gives `["steering"]`.
  - `properties["security-severity"]` for security rules only, so GitHub ranks them: `"8.0"` for error, `"5.0"` for warning, `"2.0"` for note.
- `runs[0].columnKind`: `"utf16CodeUnits"`. No `originalUriBaseIds` entry, so no absolute path ever appears in the file.
- Each finding is one result:
  - `ruleId`, `ruleIndex` (index into `rules[]`), `level` (the finding's severity), `message.text`.
  - `locations[0].physicalLocation.artifactLocation`: `uri` is the finding path with each segment percent-encoded by `encodeURIComponent` and joined with `/` (spaces, `#`, `%` and non-ASCII are encoded), `uriBaseId: "%SRCROOT%"`. GitHub code scanning reads `%SRCROOT%` as the checkout, so when `--root` is a relative subfolder the path is prefixed with it (`--root docs` gives `docs/CLAUDE.md`), as the github format does (`workspacePath` in `format/workspace.ts`). An absolute root or one starting with `..` is not prefixed. Fingerprints always use the root-relative path, so they do not change with `--root`.
  - `region`: `startLine`, `startColumn`, `endLine`, `endColumn` from the finding.
  - `partialFingerprints: { "asitis/v1": fingerprint }`.
  - `suppressions`: present only for suppressed findings, `[{ kind, justification? }]`. Suppressed results stay in the file.
  - `fixes`: with `--fix-preview`, `[{ description: { text: "<safety> fix for <ruleId>" }, artifactChanges: [{ artifactLocation (same as above), replacements: edits.map(e => ({ deletedRegion: { byteOffset: e.startByte, byteLength: e.endByte - e.startByte }, insertedContent: { text: e.replacement } })) }] }]`.
- `runs[0].invocations`: `[{ executionSuccessful: true }]` (a run that would exit 2 or 3 prints no SARIF).

## GitHub format

One workflow command per unsuppressed finding:

```
::error file=CLAUDE.md,line=12,col=1,endLine=12,endColumn=40,title=asitis(duplicate-rule)::Same rule as line 4 ...
```

- Command by severity: `error` is `::error`, `warning` is `::warning`, `note` is `::notice`. Notes are annotated only with `--annotate-notes`: every annotation lands on the pull request, and a note (a hidden comment, a missing final newline) is not worth a reviewer's attention there. Without the flag the output ends with `asitis: N notes are not shown as annotations; add --annotate-notes to show them`.
- Message escaping: `%` to `%25`, CR to `%0D`, LF to `%0A`.
- Property escaping (file and title): the same, plus `:` to `%3A` and `,` to `%2C`.
- Every annotation is exactly one output line that starts with `::`, and nothing else on stdout starts with `::`. The summary line is `asitis: Linted N files: ...` so it cannot be read as a command. Escaping CR and LF means no text from a file can start a line, so `::set-env`, `::add-mask` or a `::stop-commands::` token inside a file can never become a workflow command. WP1 must test exactly that with a fixture.
- `project.notes` become `::notice::<escaped note>`.

## Config

`.asitisrc.json` at the root, or `--config <file>` inside the root. JSON only, at most 64 KB, read through `sandbox.openAs("asitisrc", ...)`.

```json
{
  "$schema": "https://asitis.app/schema/asitisrc-1.json",
  "extends": "recommended",
  "rules": {
    "duplicate-rule": "off",
    "length": ["warning", { "claudeMdLines": 300 }],
    "sec-mcp-launcher": "error"
  },
  "ignore": ["vendor/**", "examples/**"],
  "overrides": [{ "files": ["docs/**"], "rules": { "contradiction": "off" } }],
  "include": ["skills", "config"]
}
```

- Severities in config: `error`, `warning`, `note`, `off`.
- `extends`: `recommended` (default) or `strict` (notes become warnings, `sec-*` rules on).
- Threshold options for `length`: `claudeMdLines`, `skillMdLines`, `cursorRuleLines`, `codexBytes`, `windsurfChars`, `memoryIndexLines`. Defaults stay in `limits.ts`.
- Any unknown key, unknown rule id (not in the registry, or planned), bad severity or bad option type throws `UserError` with `file line N: problem (did you mean "x"?)`. CLI: exit 2. MCP: the tool error text.
- In the MCP server the same file is read on every `lint_steering` call when it exists. The server never reads it for other tools. There, `include` and the extra scans that `strict` turns on are not applied (see Code path); severities, `off`, `ignore` and `overrides` are.
- `strict` also shows two inventory notes that are off by default because they fire on most repos: plain hooks in `.claude/settings.json` (`sec-hook-config`) and subagents without a `tools` list (`sec-skill-allowed-tools`).

## Suppression

```
<!-- asitis-disable-next-line duplicate-rule -- the two sections are alternatives -->
<!-- asitis-disable-file length -- generated reference, read on demand -->
```

- A rule id is required; there is no "disable everything".
- Rules with `suppressibleInline: false` in the registry (every `security` category rule: `hidden-*`, `invisible-char`, `bidi-control`, `unclosed-comment`, `unsafe-path`, `sec-*`, `secret-in-steering` and the rest) are not suppressed by a comment. The comment gets `suppression-not-allowed` (warning). They can be turned off in `.asitisrc.json` or the baseline only, because both show up in review.
- An unknown id gives `unknown-suppression` (warning); a comment that suppressed nothing gives `unused-suppression` (note).
- Suppressed findings are counted in every summary and kept, marked, in JSON and SARIF.

## MCP side

- `lint_steering` takes `include?: ("skills" | "config" | "config-local")[]`. Without it nothing beyond markdown is read, as in 0.2.5. With a value whose scan is not available yet, the result ends with a notice line and nothing extra is read.
- `lint_steering` text leaves suppressed findings out of the listing and says `N suppressed findings not listed.` at the end. `structuredContent.summary.suppressed` appears only when it is above 0, so 0.2.5 output stays byte-identical.
- `suggest_fixes {path?, paths?, rules?, safety?: "safe" | "all"}` is registered against `suggestFixes()` in `fix.ts`. WP7 owns its body and wording and never edits `server.ts`.
- Results stay text-only by default; `--structured` adds the JSON.

## Read classes

`paths.ts` has five read classes. Markdown is the only one the server uses for steering files by default; `asitisrc` reads AsItIs's own config, and `gitmodules` reads one file, the root `.gitmodules`, only when a relative link is missing (to tell a submodule that is not checked out from a broken link).

| Class | Policy file | Owner | Opened by |
|---|---|---|---|
| `markdown` | `policyRefusal` in `paths.ts` | WP0 | every tool |
| `asitisrc` | `policy/asitisrc.ts` | WP2 | `config.ts`, `baseline.ts` |
| `skill-script` | `policy/skill-script.ts` | WP5 | `checks/skills.ts` (include `skills`) |
| `agent-config` | `policy/agent-config.ts` | WP6 | `checks/agent-config.ts` (include `config`); also the root `package.json` and `pyproject.toml`, for the project's own name and URLs only (`checks/own.ts`) |
| `gitmodules` | `policy/gitmodules.ts` | release | `lint.ts` (broken-link): the root `.gitmodules`, 64 KB at most, only its `path =` lines |

`sandbox.openAs(readClass, path, { baseDir?, headBytes?, grants? })` applies the shared refusals (`commonRefusal`: Windows streams and devices, `.env*`, `.git`, `node_modules`), then the class policy, to the path as asked and to the real path. `headBytes` reads only the first bytes (magic-byte checks) and skips the size limit. `grants` passes the call's include values, so the agent-config policy can allow `.claude/settings.local.json` only for `config-local`. The policy stubs refuse everything until their track lands. `sandbox.listDir(path)` lists a folder without following symlinks or reading files.

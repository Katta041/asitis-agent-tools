# AsItIs GitHub Action

Lints the agent steering files in your repo (CLAUDE.md, AGENTS.md, SKILL.md, Cursor rules, Copilot instructions, GEMINI.md and the rest) on every pull request. Findings show up as annotations on the changed lines, and you can send them to code scanning as SARIF.

It runs the `asitis` CLI that is committed in this repo at `action/asitis.mjs`. Nothing is downloaded or installed when the job runs, and the linter only reads files: no network, no writes apart from the SARIF file you ask for.

## Quick start

Copy this into `.github/workflows/steering-lint.yml`. It needs read access to the code and nothing else.

```yaml
name: steering-lint

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  asitis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      - uses: Katta041/asitis-agent-tools@v0.3.0
        with:
          sarif-file: ""
```

`actions/setup-node` is required: the linter needs Node 22.13 or later and the runner's own Node is often older. Without it the step stops with one line that says so.

To pin this action to a commit as well, look up the tag's SHA and use that in place of `v0.3.0`:

```
git ls-remote https://github.com/Katta041/asitis-agent-tools refs/tags/v0.3.0
```

## With code scanning

Uploading SARIF needs `security-events: write`, so give it to this one job only. Pull requests from forks never get that permission, which is why the upload below runs on pushes to `main` only. Annotations still appear on every pull request.

```yaml
name: steering-lint

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  asitis:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
      # Private repos also need: actions: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      - uses: Katta041/asitis-agent-tools@v0.3.0
        with:
          upload-sarif: ${{ github.event_name == 'push' }}
```

The upload uses `github/codeql-action/upload-sarif`, pinned to a commit inside `action.yml`. That is GitHub's own action talking to GitHub; the linter itself never touches the network.

## Inputs

| Input | Default | What it does |
|---|---|---|
| `paths` | empty | Files to lint, one per line or separated by spaces. Empty lints every steering file under `root`. |
| `root` | `.` | The one folder the linter may read. Leave it at the repo top so annotation paths match your files. |
| `fail-on` | `error` | Lowest severity that fails the step: `error`, `warning`, `note` or `never`. |
| `format` | `github` | What the log shows. `github` makes each finding an annotation; `text` and `json` print the report. |
| `include` | empty | Comma-separated opt-in scans: `skills`, `config`, `config-local`. Empty reads markdown steering files only. |
| `config` | empty | Config file inside `root`. Empty uses `.asitisrc.json` at the root if there is one. |
| `baseline` | empty | Baseline file inside `root`. Findings listed there are reported as suppressed and do not fail the step. |
| `sarif-file` | `asitis.sarif` | Where to write the SARIF 2.1.0 report. Empty skips it. |
| `upload-sarif` | `false` | `true` uploads the SARIF file to code scanning. Needs `security-events: write`. |

## Outputs

| Output | Meaning |
|---|---|
| `exit-code` | 0 clean, 1 findings at or above `fail-on`, 2 a setup problem you can fix, 3 a bug in asitis. |
| `errors` | Number of errors, not counting suppressed ones. |
| `warnings` | Number of warnings, not counting suppressed ones. |
| `notes` | Number of notes, not counting suppressed ones. |
| `sarif-file` | Path of the SARIF file, or empty. |

The step fails on exit code 1, 2 or 3. When you want the numbers without failing the job, set `fail-on: never` and read the outputs.

## Adopting it on a repo with existing findings

Write a baseline once and commit it. Old findings then show as suppressed, and only new ones fail the check.

```
npx -y -p @asitis/mcp@0.3.0 asitis lint --format json --write-baseline > .asitis-baseline.json
```

```yaml
      - uses: Katta041/asitis-agent-tools@v0.3.0
        with:
          baseline: .asitis-baseline.json
```

## What it does, step by step

1. Checks that `node --version` is 22.13 or later. If not, it prints one line telling you to add `actions/setup-node`, and exits 2.
2. Runs `node action/asitis.mjs lint --format github` (or the format you chose). Each finding becomes one `::error`, `::warning` or `::notice` line. Text from your files is escaped, so a file cannot start a workflow command of its own.
3. If `sarif-file` is set, runs a second pass with `--format sarif` into that file.
4. If `upload-sarif` is `true`, uploads the file.
5. Fails the step if the lint pass exited non-zero.

Inputs are handed to the script as environment variables, never pasted into shell code, so a strange path or file name cannot run commands.

More setups (pre-commit, GitLab CI, plain npx) are in [docs/ci.md](../docs/ci.md).

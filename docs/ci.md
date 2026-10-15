# Running AsItIs in CI

Every setup below runs the same `asitis lint` command with the same exit codes. Pick the one that fits where your checks already live.

| Exit code | Meaning |
|---|---|
| 0 | No finding at or above `--fail-on` (default `error`). |
| 1 | At least one finding at or above `--fail-on`. |
| 2 | Something you can fix: an unknown flag, a missing path, a bad config or baseline, Node older than 22.13. One line on stderr says what. |
| 3 | A bug in asitis. One line with a link to report it. |

All of them need Node 22.13 or later. The full flag list is in [cli-contract.md](cli-contract.md).

## Plain npx

Works anywhere Node runs, nothing to install first:

```
npx -y -p @asitis/mcp@0.3.0 asitis lint
```

Keep the exact version in the command. `@latest` would let a new release change what your CI checks without a commit on your side.

Useful variants:

```
npx -y -p @asitis/mcp@0.3.0 asitis lint --fail-on warning
npx -y -p @asitis/mcp@0.3.0 asitis lint --format json > asitis.json
npx -y -p @asitis/mcp@0.3.0 asitis lint --format sarif > asitis.sarif
```

## GitHub Actions

Use the Action in this repo. It runs the CLI bundled at `action/asitis.mjs`, so there is no npm install in the job.

```yaml
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

Findings appear as annotations on the pull request. GitHub shows at most 10 annotations of each type per step; the step log and the SARIF file have every finding. [action/README.md](../action/README.md) covers every input, the outputs and the code scanning upload.

Give `root` as a path relative to the repository top. The Action turns an absolute path inside the workspace into a relative one, because annotation and SARIF paths are read relative to the checkout.

### Code scanning

The SARIF upload needs code scanning on the repo: every public repo has it, a private one needs GitHub Code Security. Without it the upload gets a 403 ("Code scanning is not enabled"). The Action runs the upload with `continue-on-error`, so the job result always comes from the lint, never from the upload. On a private repo give the job `actions: read` as well as `security-events: write`; the full workflow is in [action/README.md](../action/README.md#with-code-scanning).

### Security findings hidden by the config or baseline

`fail-on-hidden-security` is on by default. The job fails when the repo's `.asitisrc.json` (a security rule turned off or lowered, or an `ignore` pattern over a file with security findings) or the baseline hides a security finding, so a pull request cannot get a hidden instruction past CI by also editing the config or the baseline. Each hidden finding stays in the SARIF and JSON as a suppressed result with a justification, and the log has one line that counts them. The CLI does the same with `--fail-on-hidden-security`; without the flag it still prints the line. [action/README.md](../action/README.md#security-findings-the-config-or-baseline-hides) explains why this checks the result rather than the diff.

## pre-commit

Add this to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/Katta041/asitis-agent-tools
    rev: v0.3.0
    hooks:
      - id: asitis-lint
```

Then `pre-commit install`. On each commit the hook gets the staged steering files (CLAUDE.md, AGENTS.md, SKILL.md, `.cursor/rules/*.mdc` and the other kinds the linter knows) and nothing else, so a commit that only touches code or docs skips it. It runs the bundled CLI with your own `node`, which must be 22.13 or later.

To block on warnings too, which catches hidden instructions in HTML comments:

```yaml
      - id: asitis-lint
        args: [--fail-on, warning]
```

The hook uses `language: script` and the file's `#!/usr/bin/env node` line. pre-commit reads that line itself on Windows, so the same config works there; the self-test runs it on Windows to keep that true.

To try the hook without installing it:

```
pre-commit try-repo https://github.com/Katta041/asitis-agent-tools asitis-lint --ref v0.3.0 --all-files
```

### lefthook and husky

These run the npm package instead of the bundled file. `{staged_files}` in lefthook and `git diff --cached` in husky pass only what you are committing. Both lists below match the same files as the pre-commit hook's `files:` pattern.

lefthook (`lefthook.yml`). `glob_matcher: doublestar` matters: with lefthook's default matcher `**/CLAUDE.md` needs at least one folder, so a `CLAUDE.md` at the repo root would never be linted.

```yaml
glob_matcher: doublestar
pre-commit:
  commands:
    asitis:
      glob: "{**/CLAUDE.md,**/CLAUDE.local.md,**/AGENTS.md,**/GEMINI.md,**/SKILL.md,**/MEMORY.md,**/.cursorrules,**/.windsurfrules,**/.clinerules,**/.claude/agents/**/*.md,**/.claude/commands/**/*.md,**/.claude/rules/**/*.md,**/.cursor/rules/**/*.mdc,**/.windsurf/rules/**/*.md,**/.clinerules/**/*.md,.github/copilot-instructions.md,**/.github/agents/**/*.md,**/*.instructions.md,**/*.prompt.md,**/*.agent.md,**/*.chatmode.md,memory/*.md}"
      run: npx -y -p @asitis/mcp@0.3.0 asitis lint {staged_files}
```

husky (`.husky/pre-commit`). `--diff-filter=ACMR` keeps added, copied, modified and renamed files and leaves deleted ones out. `-z` with `xargs -0 -r` keeps a file name with spaces in one piece and runs nothing when no steering file is staged.

```sh
git diff --cached --name-only --diff-filter=ACMR -z -- \
  ':(glob)**/CLAUDE.md' ':(glob)**/CLAUDE.local.md' ':(glob)**/AGENTS.md' ':(glob)**/GEMINI.md' \
  ':(glob)**/SKILL.md' ':(glob)**/MEMORY.md' ':(glob)**/.cursorrules' ':(glob)**/.windsurfrules' \
  ':(glob)**/.clinerules' ':(glob)**/.claude/agents/**/*.md' ':(glob)**/.claude/commands/**/*.md' \
  ':(glob)**/.claude/rules/**/*.md' ':(glob)**/.cursor/rules/**/*.mdc' ':(glob)**/.windsurf/rules/**/*.md' \
  ':(glob)**/.clinerules/**/*.md' ':(glob).github/copilot-instructions.md' ':(glob)**/.github/agents/**/*.md' \
  ':(glob)**/*.instructions.md' ':(glob)**/*.prompt.md' ':(glob)**/*.agent.md' ':(glob)**/*.chatmode.md' \
  ':(glob)memory/*.md' \
  | xargs -0 -r npx -y -p @asitis/mcp@0.3.0 asitis lint
```

## GitLab CI

```yaml
asitis:
  stage: test
  image: node:22
  script:
    - npx -y -p @asitis/mcp@0.3.0 asitis lint
```

To keep the full report with the job, write JSON as an artifact. `--fail-on never` lets the second command decide the job result:

```yaml
asitis:
  stage: test
  image: node:22
  script:
    - npx -y -p @asitis/mcp@0.3.0 asitis lint --format json --fail-on never > asitis.json
    - npx -y -p @asitis/mcp@0.3.0 asitis lint
  artifacts:
    when: always
    paths:
      - asitis.json
```

GitLab does not read SARIF in its merge request widgets, so there is no inline view there yet. The job log shows each finding as `path:line:col severity rule-id message`.

## Other CI systems

Anything that can run Node 22.13 can run the npx line. Use `--format sarif` where the system reads SARIF (Azure DevOps with the SARIF viewer extension, for example), and `--format json` where you want to post-process the results. The JSON schema is in [cli-contract.md](cli-contract.md) and stays at `schemaVersion: 1` for all of 0.x.

## Adopting the linter on an existing repo

Write a baseline, commit it, and point CI at it. Findings listed there are reported as suppressed, and only new ones fail.

```
npx -y -p @asitis/mcp@0.3.0 asitis lint --format json --write-baseline > .asitis-baseline.json
npx -y -p @asitis/mcp@0.3.0 asitis lint --baseline .asitis-baseline.json
```

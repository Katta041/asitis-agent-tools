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

Findings appear as annotations on the pull request. [action/README.md](../action/README.md) covers every input, the outputs and the code scanning upload.

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
pre-commit try-repo https://github.com/Katta041/asitis-agent-tools asitis-lint --all-files
```

### lefthook and husky

These run the npm package instead of the bundled file. `{staged_files}` in lefthook and `git diff --cached` in husky pass only what you are committing. The `--diff-filter=ACM` keeps deleted files out.

lefthook (`lefthook.yml`):

```yaml
pre-commit:
  commands:
    asitis:
      glob: "{**/CLAUDE.md,**/AGENTS.md,**/GEMINI.md,**/SKILL.md,**/.cursor/rules/*.mdc,**/.claude/**/*.md,.github/copilot-instructions.md}"
      run: npx -y -p @asitis/mcp@0.3.0 asitis lint {staged_files}
```

husky (`.husky/pre-commit`):

```sh
files=$(git diff --cached --name-only --diff-filter=ACM -- '*CLAUDE.md' '*AGENTS.md' '*GEMINI.md' '*SKILL.md' '*.mdc' '.claude/*.md')
[ -z "$files" ] || npx -y -p @asitis/mcp@0.3.0 asitis lint $files
```

The husky line splits on spaces, so a steering file with a space in its name breaks it.

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

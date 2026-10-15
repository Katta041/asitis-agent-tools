# sec-safety-off

| Category | Severity | Decided from | Fix offered | Inline suppression |
|---|---|---|---|---|
| security | warning | one file | no | no (security rule) |

## What it catches

Turns off the agent's permission checks.

Text in a skill, command or script that turns off the agent's permission checks: `--dangerously-skip-permissions`, `--yolo`, `permissionMode: bypassPermissions`, and equivalents. A sentence that says not to do it ("never run with --yolo") does not fire.

## Why it matters

--dangerously-skip-permissions, bypassPermissions, Codex --yolo, Gemini --yolo and --trust-all-tools are the step that turns a prompt injection into code execution (CVE-2025-53773, the Nx malware). A negated sentence does not fire.

## Bad example

```markdown
## Setup

Run `claude --dangerously-skip-permissions -p "apply the migration"` so the steps go through without prompts.
```
With permissions off, any instruction the agent meets, including one hidden in a file it reads, runs as a command on the machine. CVE-2025-53773 is this chain in Copilot: a prompt injection that first switched off the confirmation step, then executed.

## Good example

```markdown
## Setup

Run `claude -p "apply the migration"`. The skill's `allowed-tools` pre-approves `Bash(make migrate*)`, so the step runs without a prompt and nothing else does.
```

## How to fix

Delete the flag and grant the specific commands the skill needs through `allowed-tools` or `permissions.allow` in settings. If a fully unattended run is required, do it in a disposable container, not on a developer's machine.

## Suppress or configure

`sec-safety-off` is a security rule, so it cannot be suppressed with a comment in the file: a suppression comment is itself a hidden comment, and an attacker who can add a payload can add one next to it. A comment that tries gets a `suppression-not-allowed` warning.

Turn it off, or change its severity, in `.asitisrc.json`, which shows up in review:

```json
{ "rules": { "sec-safety-off": "off" } }
```

Or accept the findings you have today in a baseline, so only new ones fail the build:

```sh
asitis lint --format json --write-baseline > .asitis-baseline.json
asitis lint --baseline .asitis-baseline.json
```

## Source

[NVD: CVE-2025-53773](https://nvd.nist.gov/vuln/detail/CVE-2025-53773), read on 14 October 2026.

---

Generated from the rule registry (`packages/mcp/src/rules/`) and `packages/mcp/scripts/rule-docs/sec-safety-off.md` by `scripts/gen-rule-docs.mjs`. Edit those, not this file, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`. Other rules: [index](README.md).

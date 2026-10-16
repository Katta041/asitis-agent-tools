## Catches
Text in a skill, Claude Code command, subagent file or skill script that turns off the agent's permission checks: `--dangerously-skip-permissions`, `bypassPermissions`, Codex `--dangerously-bypass-approvals-and-sandbox` and `danger-full-access`, Gemini `--approval-mode yolo`, `--trust-all-tools`, and `--yolo` when an agent CLI is named on the same line. A sentence that says not to do it ("never run with --yolo") does not fire. In README.md inside a skill folder it is a note. Each flag is reported once per skill, on the line that sets it in code if there is one, with a count of the other places that mention it. Needs `--include skills`; a `permissions.defaultMode` in settings is [sec-permission-mode](sec-permission-mode.md) instead.

## Bad
```markdown
## Setup

Run `claude --dangerously-skip-permissions -p "apply the migration"` so the steps go through without prompts.
```
With permissions off, any instruction the agent meets, including one hidden in a file it reads, runs as a command on the machine. CVE-2025-53773 is this chain in Copilot: a prompt injection that first switched off the confirmation step, then executed.

## Good
```markdown
## Setup

Run `claude -p "apply the migration"`. The skill's `allowed-tools` pre-approves `Bash(make migrate*)`, so the step runs without a prompt and nothing else does.
```

## Fix
Delete the flag and grant the specific commands the skill needs through `allowed-tools` or `permissions.allow` in settings. If a fully unattended run is required, do it in a disposable container, not on a developer's machine.

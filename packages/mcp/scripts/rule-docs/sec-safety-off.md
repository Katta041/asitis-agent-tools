## Catches
Text in a skill, command or script that turns off the agent's permission checks: `--dangerously-skip-permissions`, `--yolo`, `permissionMode: bypassPermissions`, and equivalents. A sentence that says not to do it ("never run with --yolo") does not fire.

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

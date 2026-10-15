## Catches
An `AGENTS.override.md`, `AGENTS.local.md` or `.agents/*.md` file. Codex reads AGENTS.override.md in place of AGENTS.md; Claude Code never reads any of these. The note says which agents load the file, so nobody assumes it applies everywhere.

## Bad
```text
AGENTS.md
AGENTS.override.md   # "Skip the integration tests this week"
```
Codex follows the override, Claude Code and Cursor follow AGENTS.md. The team sees different behaviour from different agents and does not know why.

## Good
```text
AGENTS.md            # one file every agent reads
```

## Fix
Keep instructions that apply to everyone in AGENTS.md. Use an override only as a short-lived local file, and delete it when the reason is gone. If a variant must stay, say in AGENTS.md which agents read it.

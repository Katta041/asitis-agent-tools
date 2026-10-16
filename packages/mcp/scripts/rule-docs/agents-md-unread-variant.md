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
Merge the content into AGENTS.md if every agent should follow it. Use an override only as a short-lived local file, and delete it when the reason is gone. A variant that a loaded file points at on purpose is not reported: for AGENTS.local.md or a file under `.agents/`, mention it by name in a loaded file (better, import it); for AGENTS.override.md, import it from a CLAUDE.md with `@AGENTS.override.md`.

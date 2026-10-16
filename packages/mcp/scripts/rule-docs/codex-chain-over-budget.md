## Catches
Codex reads every `AGENTS.md` (or `AGENTS.override.md`) from the project root down to the folder it starts in, and stops at 32 KiB in total (`project_doc_max_bytes`). This rule adds the chain up for each folder that has one and says which file gets cut or dropped. Only runs when the whole folder is linted.

## Bad
```text
AGENTS.md                 30 KB of shared rules
packages/api/AGENTS.md     6 KB of API rules
```
Started in `packages/api`, Codex reads the 30 KB root file and then only the first 2 KB or so of the API file. The rest of the API rules never reach it.

## Good
```text
AGENTS.md                 8 KB: what every package needs
packages/api/AGENTS.md     6 KB of API rules
docs/agents/style.md       linked from AGENTS.md, read when needed
```

## Fix
Shorten the files higher up the chain, since they count against every folder below. Move reference material into files the agent opens when it needs them. If the chain really needs to be longer, raise `project_doc_max_bytes` in `~/.codex/config.toml`, knowing every Codex session then spends that much context on it.

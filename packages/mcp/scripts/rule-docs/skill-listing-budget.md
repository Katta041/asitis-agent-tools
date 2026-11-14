## Catches
A set of skills Claude Code lists together whose names and descriptions add up to more than about 8,000 characters. A set is a `.claude` folder (its `skills/` and `commands/`) or a plugin folder with `.claude-plugin/plugin.json` and a `skills/` folder. Each entry counts its name plus `description` and `when_to_use`, cut at 1,536 characters as Claude Code cuts them. Skills with `disable-model-invocation: true` are not counted: their description is not in context. Only whole-folder runs report it, since every skill in the set has to be seen. Skill folders for other agents (`.gemini/skills`, `.agents/skills`) are not counted.

## Bad
```text
.claude/skills/  87 skills, 21,260 characters of names and descriptions
```
Claude Code keeps every name but drops the descriptions of the skills you use least, so Claude stops choosing them on its own even when a request matches.

## Good
```text
.claude/skills/  40 skills, 7,400 characters; release and deploy skills set disable-model-invocation: true
```

## Fix
Shorten long descriptions (the message names the longest), remove skills you no longer use, and set `disable-model-invocation: true` on skills you only run by hand with `/name`. With a 1M context window the budget is about five times larger; set `budgetChars` to match what your team runs, for example `{ "rules": { "skill-listing-budget": ["note", { "budgetChars": 40000 }] } }`. `maxDescChars` matches Claude Code's `skillListingMaxDescChars` (default 1,536).

## Catches
Agent session data committed into the tree, found by file and folder names and, for a bare `<uuid>.jsonl`, by the first 4 KB of the file:

- Claude Code transcripts and state copied from `~/.claude`: `.claude/projects/...`, folders named like `-home-me-app` holding `<uuid>.jsonl` or `memory/*.md`, `history.jsonl`, `file-history/`, `shell-snapshots/`, `todos/`;
- Codex `rollout-<timestamp>-<uuid>.jsonl` sessions and `.codex/history.jsonl`;
- Gemini CLI chats, logs and checkpoints under `.gemini/tmp/<hash>/`;
- Aider's `.aider.chat.history.md` and `.aider.input.history`;
- SpecStory's `.specstory/history/`, as a note, since SpecStory saves chats in the repo on purpose.

Files a `.gitignore` covers are skipped, and findings are grouped by folder. The content is never quoted. Runs only at the top of a git checkout. Needs `--include config`.

## Bad
```
notes/
  -home-dev-shop/
    3f2a9c4e-8b1d-4e6f-a2c7-5d9e0b1f4a6c.jsonl
    memory/MEMORY.md
.aider.chat.history.md
```
A transcript holds every file the agent read, every command output and everything pasted into the chat, keys included.

## Good
```
# .gitignore
.aider*
**/.claude/projects/
```
Share a summary or a cleaned excerpt instead of the raw session.

## Fix
Read the files for secrets and rotate anything you find, then delete them from the repo and add the pattern from the message to `.gitignore`. Deleting does not remove them from git history, which is why rotating comes first.

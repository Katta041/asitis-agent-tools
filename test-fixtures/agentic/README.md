# Agentic fixtures

Simulated steering files for the `@asitis/mcp` and Claude Code plugin tests. Byte-exact: never open and save these in an editor.

- `repo/`: a project with CLAUDE.md (@imports, one missing), AGENTS.md, GEMINI.md, skills (valid and broken), a subagent, a command, rules, Cursor `.mdc` rules (one CRLF + BOM), Copilot instructions, a memory index, a file with zero-width characters and a hidden instruction comment, and two files the server must refuse (`.env`, `.claude/settings.json`).
- `crlf-bom-skill/SKILL.md`: a skill saved with a BOM and CRLF line endings.

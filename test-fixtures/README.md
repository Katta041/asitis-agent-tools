# Test fixtures

Byte-exact inputs for the tests. **Never open and save these files in an editor**: line endings, BOMs, trailing spaces and invalid bytes are the point. `.gitattributes` stops git from converting them.

- `agentic/`: simulated steering files (CLAUDE.md, AGENTS.md, GEMINI.md, skills, subagents, commands, rules, Cursor `.mdc`, Copilot instructions, memory). See [`agentic/README.md`](agentic/README.md).
- `encodings/`: byte-level cases (lone CR, mixed line endings, invalid UTF-8, BOM variants, UTF-16, NUL bytes, no final newline).

All content is simulated. The `.env` file holds a fake token that the server must refuse to read.

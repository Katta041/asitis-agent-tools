# asitis rules

One page per rule: what it catches, why it matters, a bad and a good example, how to fix it, how to suppress or configure it, and the vendor page or incident it rests on. 73 rules are active in this build. Each finding in `asitis lint --format sarif` links to its page as `https://github.com/Katta041/asitis-agent-tools/blob/main/docs/rules/<rule-id>.md`.

Severity is the default; `.asitisrc.json` can change it. Where it says "depends on location" or "varies", the rule reports some findings at a lower severity (a note in a README, a note for a CLAUDE.md just over 200 lines); the rule page says when. Security rules can be turned off in `.asitisrc.json` or in a baseline, never with a comment in the file.

## Format and vendor rules

The file is not read the way its author expects: frontmatter, required fields, values a tool rejects, links and imports that go nowhere, bytes that are not UTF-8.

| Rule | Severity | What it catches |
|---|---|---|
| [frontmatter-not-line-1](frontmatter-not-line-1.md) | error | Frontmatter does not start on line 1 |
| [frontmatter-bom](frontmatter-bom.md) | warning | A byte order mark comes before the frontmatter |
| [frontmatter-unclosed](frontmatter-unclosed.md) | error | Frontmatter opens with --- and never closes |
| [frontmatter-yaml](frontmatter-yaml.md) | error | Frontmatter is not valid YAML |
| [frontmatter-not-mapping](frontmatter-not-mapping.md) | error | Frontmatter is valid YAML but not a key: value mapping |
| [frontmatter-too-large](frontmatter-too-large.md) | error | Frontmatter is too large to parse safely |
| [frontmatter-value-cut](frontmatter-value-cut.md) | warning | An unquoted value is cut short at " #" |
| [missing-frontmatter](missing-frontmatter.md) | error | A file that needs frontmatter has none |
| [missing-name](missing-name.md) | error | Required name field is missing |
| [missing-description](missing-description.md) | error | Required description field is missing |
| [field-type](field-type.md) | error | A frontmatter field has the wrong type |
| [name-too-long](name-too-long.md) | error | Skill name is longer than 64 characters |
| [name-format](name-format.md) | error | Skill name is not lowercase letters, digits and single hyphens |
| [name-dir-mismatch](name-dir-mismatch.md) | warning | Skill name does not match its folder name |
| [name-reserved-word](name-reserved-word.md) | note | Skill name contains anthropic or claude |
| [xml-tag](xml-tag.md) | warning | Skill name or description contains an XML tag |
| [description-too-long](description-too-long.md) | error | Skill description is longer than 1,024 characters |
| [compatibility-too-long](compatibility-too-long.md) | warning | compatibility is longer than 500 characters |
| [unknown-key](unknown-key.md) | note | A frontmatter key the reading tool ignores |
| [memory-type](memory-type.md) | warning | Memory file type is not user, feedback, project or reference |
| [never-applied](never-applied.md) | warning | Cursor rule has no alwaysApply, globs or description |
| [missing-applyTo](missing-applyTo.md) | warning | Copilot instructions file has neither applyTo nor description |
| [encoding](encoding.md) | warning | File is not UTF-8 |
| [invalid-utf8](invalid-utf8.md) | warning | File contains invalid UTF-8 bytes |
| [nul-bytes](nul-bytes.md) | warning | File contains NUL bytes |
| [mixed-eol](mixed-eol.md) | note | File mixes CRLF, LF or CR line endings |
| [broken-link](broken-link.md) | warning, varies | Relative link or anchor points to nothing |
| [broken-import](broken-import.md) | warning | @import names a file that does not exist |
| [link-outside-root](link-outside-root.md) | note | Link points outside the project and was not checked |
| [import-outside-root](import-outside-root.md) | warning | @import reaches outside the project |
| [orphan-memory](orphan-memory.md) | warning | Memory topic file is not linked from MEMORY.md |
| [trailing-whitespace](trailing-whitespace.md) | note | Lines end in spaces or tabs that change nothing when rendered |
| [final-newline](final-newline.md) | note | File with line breaks does not end with one |

## Context budget

The file costs more context than it earns, or more than the tool will read.

| Rule | Severity | What it catches |
|---|---|---|
| [description-truncated](description-truncated.md) | warning | description plus when_to_use is cut in the skill listing |
| [length](length.md) | warning, varies | File is longer than the vendor recommends or reads |
| [body-tokens](body-tokens.md) | warning, varies | SKILL.md body is over about 5,000 tokens |
| [context-cost](context-cost.md) | note | Over 5,000 tokens load every session from this file |
| [duplicate-rule](duplicate-rule.md) | warning, varies | The same rule appears twice in one file |
| [duplicate-across-files](duplicate-across-files.md) | warning | The same rule is in two files one tool loads every session |
| [codex-chain-over-budget](codex-chain-over-budget.md) | warning | AGENTS.md files from the root down exceed Codex's 32 KiB |

## Security

Content a reviewer does not see but an agent does, and other signs of a steering file that was tampered with. These rules can be turned off in `.asitisrc.json` or a baseline, never with a comment in the file.

| Rule | Severity | What it catches |
|---|---|---|
| [invisible-char](invisible-char.md) | error | Invisible Unicode characters |
| [bidi-control](bidi-control.md) | error | Bidirectional control characters |
| [hidden-instruction](hidden-instruction.md) | error | Hidden comment that reads like an instruction to the agent |
| [hidden-comment](hidden-comment.md) | note | Comments hidden in rendered views |
| [hidden-styled-text](hidden-styled-text.md) | warning | Inline style or the hidden attribute hides text |
| [unclosed-comment](unclosed-comment.md) | warning | HTML comment never closes |
| [unsafe-path](unsafe-path.md) | warning | File path contains control, bidi or invisible characters |
| [sec-remote-exec](sec-remote-exec.md) | error, depends on location | Downloads code and runs it (curl or wget piped to a shell, and similar) |
| [sec-encoded-blob](sec-encoded-blob.md) | warning, depends on location | Decodes base64 or hex and runs the result, or hides a command in an encoding |
| [sec-secret-egress](sec-secret-egress.md) | error, depends on location | Reads a secret and sends data over the network in the same script or block |
| [sec-skill-network](sec-skill-network.md) | note | Skill script makes network calls |
| [sec-skill-allowed-tools](sec-skill-allowed-tools.md) | warning | allowed-tools grants unscoped Bash, all tools, any interpreter or unscoped WebFetch |
| [sec-skill-binary](sec-skill-binary.md) | warning | Executable binary inside a skill folder |
| [sec-safety-off](sec-safety-off.md) | warning, depends on location | Turns off the agent's permission checks |
| [sec-skill-arg-injection](sec-skill-arg-injection.md) | warning | Skill argument is pasted into a !`command` that runs when the skill loads |
| [sec-script-instruction](sec-script-instruction.md) | warning | A script's comment or string gives the agent covert instructions |
| [sec-script-invisible](sec-script-invisible.md) | warning | Invisible or bidirectional characters in a skill script |
| [sec-hook-config](sec-hook-config.md) | error, varies | Project hook or settings command fetches remote code, calls the network or redirects the API |
| [sec-permission-allow](sec-permission-allow.md) | error, varies | Allow rule or trust flag skips the prompt for any shell command, network tool or interpreter |
| [sec-permission-mode](sec-permission-mode.md) | warning | Settings turn on bypassPermissions or skip its confirmation |
| [sec-no-secret-deny](sec-no-secret-deny.md) | note | The folder has a .env file but no permissions.deny rule keeps Claude Code out of it |
| [sec-mcp-launcher](sec-mcp-launcher.md) | warning | MCP server runs an unpinned package or image, a downloaded script, or connects over plain http |
| [sec-mcp-inline-secret](sec-mcp-inline-secret.md) | error | A key or token is written in plain text in an MCP server or settings env block |

## Drift

Two instructions, in one file or across files, disagree.

| Rule | Severity | What it catches |
|---|---|---|
| [contradiction](contradiction.md) | warning | Two lines in one file say opposite things |
| [agents-md-shadowed](agents-md-shadowed.md) | warning | Claude Code reads CLAUDE.md here and skips AGENTS.md |
| [claude-local-hides-agents-md](claude-local-hides-agents-md.md) | warning | A CLAUDE.local.md switches off the AGENTS.md fallback |
| [agents-md-unread-variant](agents-md-unread-variant.md) | note | AGENTS.override.md, AGENTS.local.md or .agents/*.md is read by some agents only, or by none |
| [cross-file-contradiction](cross-file-contradiction.md) | warning | Two files loaded for the same agent, or mirrored for different agents, contradict |
| [instruction-drift](instruction-drift.md) | note | Mirrored instruction files share most rules but not all |

## Configuration

Problems in asitis's own configuration and suppression comments.

| Rule | Severity | What it catches |
|---|---|---|
| [suppression-not-allowed](suppression-not-allowed.md) | warning | Inline suppression of a security rule |
| [unknown-suppression](unknown-suppression.md) | warning | asitis-disable names a rule that does not exist, or no rule at all |
| [unused-suppression](unused-suppression.md) | note | asitis-disable comment suppresses nothing |
| [config-json-invalid](config-json-invalid.md) | error | Agent config file is not valid JSON |

---

Generated by `packages/mcp/scripts/gen-rule-docs.mjs` from the rule registry. Rules whose status is still planned have no page. To add or change a page, edit `packages/mcp/src/rules/*.meta.ts` or `packages/mcp/scripts/rule-docs/<rule-id>.md`, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`.

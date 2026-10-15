# asitis rules

One page per rule: what it catches, why it matters, a bad and a good example, how to fix it, how to suppress or configure it, and the vendor page or incident it rests on. 45 rules are active in this build. Each finding in `asitis lint --format sarif` links to its page as `https://asitis.app/rules/<rule-id>`.

Severity is the default; `.asitisrc.json` can change it. Security rules can be turned off there or in a baseline, never with a comment in the file.

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
| [name-reserved-word](name-reserved-word.md) | warning | Skill name contains anthropic or claude |
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
| [broken-link](broken-link.md) | warning | Relative link or anchor points to nothing |
| [broken-import](broken-import.md) | warning | @import names a file that does not exist |
| [link-outside-root](link-outside-root.md) | note | Link points outside the project and was not checked |
| [import-outside-root](import-outside-root.md) | warning | @import reaches outside the project |
| [orphan-memory](orphan-memory.md) | warning | Memory topic file is not linked from MEMORY.md |

## Context budget

The file costs more context than it earns, or more than the tool will read.

| Rule | Severity | What it catches |
|---|---|---|
| [description-truncated](description-truncated.md) | warning | description plus when_to_use is cut in the skill listing |
| [length](length.md) | warning | File is longer than the vendor recommends or reads |
| [body-tokens](body-tokens.md) | warning | SKILL.md body is over about 5,000 tokens |
| [context-cost](context-cost.md) | note | Over 5,000 tokens load every session from this file |
| [duplicate-rule](duplicate-rule.md) | warning | The same rule appears twice in one file |
| [duplicate-across-files](duplicate-across-files.md) | warning | The same rule is in two files one tool loads every session |

## Security

Content a reviewer does not see but an agent does, and other signs of a steering file that was tampered with. These rules can be turned off in `.asitisrc.json` or a baseline, never with a comment in the file.

| Rule | Severity | What it catches |
|---|---|---|
| [invisible-char](invisible-char.md) | warning | Invisible Unicode characters |
| [bidi-control](bidi-control.md) | warning | Bidirectional control characters |
| [hidden-instruction](hidden-instruction.md) | warning | Hidden comment that reads like an instruction to the agent |
| [hidden-comment](hidden-comment.md) | note | Comments hidden in rendered views |
| [hidden-styled-text](hidden-styled-text.md) | warning | Inline style or the hidden attribute hides text |
| [unclosed-comment](unclosed-comment.md) | warning | HTML comment never closes |
| [unsafe-path](unsafe-path.md) | warning | File path contains control, bidi or invisible characters |

## Drift

Two instructions, in one file or across files, disagree.

| Rule | Severity | What it catches |
|---|---|---|
| [contradiction](contradiction.md) | warning | Two lines in one file say opposite things |

---

Generated by `packages/mcp/scripts/gen-rule-docs.mjs` from the rule registry. Rules whose status is still planned have no page. To add or change a page, edit `packages/mcp/src/rules/*.meta.ts` or `packages/mcp/scripts/rule-docs/<rule-id>.md`, then run `node scripts/gen-rule-docs.mjs` from `packages/mcp`.

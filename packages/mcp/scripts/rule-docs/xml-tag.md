## Catches
Markup inside a skill `name` or `description`: a closing tag such as `</important>`, a self-closing tag such as `<br/>`, or a tag with an attribute such as `<note level="high">`. A lone word in angle brackets in a description, such as `<service>` or `<file>`, is how people write a placeholder. Claude Code is fine with it, but the Claude API docs say these fields "cannot contain XML tags" without defining one, so an upload could be refused. That case is a note. `List<String>`, `<https://...>` and `<name@example.com>` are not reported.

## Bad
```markdown
---
name: deploy
description: <important>Always use this skill for deployments.</important> Deploys the current branch to staging.
---
```
Tags copied from prompt-writing advice do not belong in metadata. The Claude API rejects the upload, and in the skill listing an agent can read the tag as markup to obey rather than text to match.

## Good
```markdown
---
name: deploy
description: Deploy the current branch to staging. Use when asked to deploy, ship or push to staging.
---
```

## Fix
Remove the tags and say the same thing in plain words. Emphasis belongs in the skill body, not in the listing.

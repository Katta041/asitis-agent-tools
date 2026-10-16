## Catches
Markup inside a skill `name` or `description`: a closing tag such as `</important>`, a self-closing tag such as `<br/>`, or a tag with an attribute such as `<note level="high">`. A lone word in angle brackets, such as `<number>` or `<file>`, is how people write a placeholder, so it is not reported. The Claude API docs say only that these fields "cannot contain XML tags" without defining one, so an upload that the API rejects for a placeholder is possible; this rule does not catch that case.

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

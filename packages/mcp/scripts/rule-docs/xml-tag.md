## Catches
An XML or HTML tag such as `<important>` or `<br>` inside a skill `name` or `description`.

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

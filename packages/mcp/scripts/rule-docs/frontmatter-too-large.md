## Catches
An opening `---` followed by more than 64 KB before any closing `---`. asitis does not parse a block that size, because hostile YAML can take a long time to read, and no real frontmatter comes close: `name`, `description` and a few options fit in a few hundred bytes.

## Bad
```markdown
---
name: brand-assets
description: Apply the brand kit. Use when producing slides or documents.
logo: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABLAAAASwCAYAAAAK...
---
```
A base64 image pasted into the frontmatter pushes it far past 64 KB. The other common cause is a missing closing `---` in a long file, which makes the "frontmatter" run to the end of the document.

## Good
```markdown
---
name: brand-assets
description: Apply the brand kit. Use when producing slides or documents.
---

The logo is in [assets/logo.png](assets/logo.png).
```

## Fix
Move bulk data into a file next to `SKILL.md` and link to it. If the block is large only because the closing `---` is missing, add it after the last field.

## Catches
A `SKILL.md` whose body, after the frontmatter, is over about 5,000 tokens. The Agent Skills spec recommends staying under that and moving detail into files the skill references, which load only when needed.

## Bad
```markdown
---
name: aws-cost-report
description: Build the monthly AWS cost report. Use when asked for cloud spend or a cost breakdown.
---

# AWS cost report

## Steps
...

## Appendix A: every Cost Explorer dimension and its filter syntax
...3,000 words...

## Appendix B: sample JSON responses
...2,500 words...
```
About 7,800 tokens enter the context every time the skill runs, most of it reference material the task rarely needs.

## Good
```markdown
---
name: aws-cost-report
description: Build the monthly AWS cost report. Use when asked for cloud spend or a cost breakdown.
---

# AWS cost report

## Steps
...

Dimension and filter syntax: [references/dimensions.md](references/dimensions.md).
Sample responses: [references/samples.md](references/samples.md).
```

## Fix
Keep the steps and the decisions in `SKILL.md`. Move tables, long examples and API detail into `references/` and link them with relative paths, one level deep.

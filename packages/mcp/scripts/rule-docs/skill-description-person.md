## Catches
A skill description in which the skill speaks for itself: "I can help you...", "I will...", "I'm a ... expert", "Let me...", or the "You can use this to..." form Anthropic's guide gives as an example to avoid. Quoted user phrases ("help me write a commit", 'what did I do yesterday') are ignored, and so are descriptions addressed to Claude ("Use when you need...", "You should use this skill when..."), which Anthropic's own published skills use. Non-English descriptions are skipped.

## Bad
```markdown
---
name: ts-review
description: TypeScript reviewer. I can help you find type errors, and I will suggest a stricter tsconfig.
---
```

## Good
```markdown
---
name: ts-review
description: Reviews TypeScript code for type errors and suggests a stricter tsconfig. Use when the user asks for a TypeScript review or a tsconfig change.
---
```

## Fix
Rewrite the description in third person: say what the skill does ("Reviews...", "Generates...") and when to use it.

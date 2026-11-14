## Catches
A skill description that is template placeholder text ("TODO", "Replace with description of the skill..."), or a short one made only of words that could describe any skill ("Helps with documents", "Processes data"). Only descriptions of 12 words or fewer are judged, and one word that names a file type, tool, product or concrete task is enough to pass. Skills in template and test folders, skills with `disable-model-invocation: true` (Claude never sees their description) and descriptions that are not in English are skipped.

## Bad
```markdown
---
name: docs-helper
description: Helps with documents
---
```
Claude sees this line next to every other skill's description and has nothing to match "turn this PDF into a Word file" against.

## Good
```markdown
---
name: docs-helper
description: Converts PDF and Word files, fills PDF forms and merges documents. Use when the user mentions PDFs, .docx files, forms or merging documents.
---
```

## Fix
Say what the skill does and when to use it, with the words a user would actually type: file types, tool names, the task. Anthropic's skill guide lists "Helps with documents", "Processes data" and "Does stuff with files" as descriptions to avoid. The word limit is the `maxWords` option, for example `{ "rules": { "skill-description-vague": ["note", { "maxWords": 8 }] } }`.

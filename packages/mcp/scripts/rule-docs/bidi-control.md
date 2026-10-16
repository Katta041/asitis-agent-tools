## Catches
Unicode bidirectional controls: right-to-left and left-to-right overrides, embeddings, isolates and marks (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C). They change the order in which text is displayed without changing the order in which it is stored, which is the Trojan Source technique.

## Bad
```markdown
- Deploy to [U+202E]gnigats[U+202C] only after review.
```
Rendered, the override reverses the following letters, so a reviewer reads "Deploy to staging only after review". The stored text, which the agent reads, is `gnigats`, and more elaborate versions reorder whole clauses so that "never" and "always" swap places.

## Good
```markdown
- Deploy to staging only after review.
```

## Fix
Delete the controls and rewrite the line as it was meant to read. The proposed fix removes them but needs a look, because the visible order may have been the intended one. GitHub, VS Code and most modern editors highlight bidi controls; `grep -nP '[\x{202A}-\x{202E}\x{2066}-\x{2069}]'` finds them from the shell. Steering files for projects that genuinely contain right-to-left text should keep that text in its own paragraphs rather than rely on controls.

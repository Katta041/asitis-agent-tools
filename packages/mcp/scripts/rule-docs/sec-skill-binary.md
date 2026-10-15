## Catches
An executable binary (ELF, Mach-O or PE, recognised by the first four bytes) inside a skill folder. Needs `--include skills`.

## Bad
```text
.claude/skills/image-tools/
  SKILL.md
  scripts/convert        # Mach-O 64-bit executable, 2.1 MB
```
`SKILL.md` says "run scripts/convert on the file". Nobody can read what the binary does, and it is committed as if it were a script.

## Good
```text
.claude/skills/image-tools/
  SKILL.md
  scripts/convert.py     # 60 lines, calls Pillow
```

## Fix
Replace the binary with source, or with an install step for a published package pinned to a version. If a binary is unavoidable, keep it out of the skill folder, document where it comes from, and record its hash in `SKILL.md`.

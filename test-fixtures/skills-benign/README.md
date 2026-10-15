# skills-benign

Skill folders that must give no errors when scanned with `include: ["skills"]`. Notes and warnings are
allowed (an unscoped `allowed-tools: Bash` is a real warning; an install snippet in a README is a note).

- `anthropics/`: seven skills copied from https://github.com/anthropics/skills at commit dbd4588
  (2026-10-09). Apache License 2.0, see each `LICENSE.txt`. Modified only to replace em-dashes with
  hyphens and to drop executable bits. The docx, pdf, pptx and xlsx skills are not copied because they
  are not under an open licence.
- `own/`: everyday skills written for this corpus: a formatter, a test runner, an API client that reads
  its key from the environment, and a deploy helper that uses an SSH key with `ssh -i`.

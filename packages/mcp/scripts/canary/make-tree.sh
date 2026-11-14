#!/bin/sh
# Builds the two canary trees used to check the load model against a real agent CLI.
# Usage: scripts/canary/make-tree.sh <empty folder>. Each canary is CNRY-<NAME>.
set -e
T=$1
rm -rf "$T"; mkdir -p "$T"
A="$T/a"; mkdir -p "$A"; (cd "$A" && git init -q)
w() { mkdir -p "$(dirname "$A/$1")"; printf '%s\n' "$2" > "$A/$1"; }
w CLAUDE.md "# Project
Canary: CNRY-ROOTCLAUDE
@docs/i1.md"
w docs/i1.md "Canary: CNRY-IMP1
@i2.md"
w docs/i2.md "Canary: CNRY-IMP2
@i3.md"
w docs/i3.md "Canary: CNRY-IMP3
@i4.md"
w docs/i4.md "Canary: CNRY-IMP4
@i5.md"
w docs/i5.md "Canary: CNRY-IMP5"
w CLAUDE.local.md "Canary: CNRY-ROOTLOCAL"
w AGENTS.md "Canary: CNRY-ROOTAGENTS"
w .claude/rules/always.md "Canary: CNRY-RULEALWAYS
@../../docs/ruleimp.md"
w docs/ruleimp.md "Canary: CNRY-RULEIMPORT"
w .claude/rules/scoped.md "---
paths:
  - \"src/**/*.ts\"
---
Canary: CNRY-RULESCOPED"
w .claude/rules/anyname.md "---
paths:
  - \"*.cfg\"
---
Canary: CNRY-RULEBASENAME"
w .claude/skills/root-skill/SKILL.md "---
name: root-skill
description: Root skill, canary CNRY-SKILLROOT.
---
Body CNRY-SKILLROOTBODY"
w .agents/skills/shared-skill/SKILL.md "---
name: shared-skill
description: Shared skill, canary CNRY-SKILLAGENTS.
---
Body"
w src/a.ts "export const a = 1;"
w deep/x/settings.cfg "k=v"
w pkg/CLAUDE.md "Canary: CNRY-PKGCLAUDE
@pkgimp.md"
w pkg/pkgimp.md "Canary: CNRY-PKGIMPORT"
w pkg/AGENTS.md "Canary: CNRY-PKGAGENTS"
w pkg/.claude/rules/pkgrule.md "Canary: CNRY-PKGRULE"
w pkg/.claude/skills/pkg-skill/SKILL.md "---
name: pkg-skill
description: Package skill, canary CNRY-SKILLPKG.
---
Body"
w pkg/sub/CLAUDE.md "Canary: CNRY-SUBCLAUDE"
w pkg/sub/file.txt "hello"
w pkg/file.txt "hello"
w sibling/CLAUDE.md "Canary: CNRY-SIBLING"
w sibling/file.txt "hello"
# 50,000 characters: head canary, filler, tail canary
mkdir -p "$A/big"; python3 - "$A/big/CLAUDE.md" <<'PY'
import sys
body = "Canary: CNRY-BIGHEAD\n" + ("- filler line to pad this file out past the limit\n" * 1000) + "Canary: CNRY-BIGTAIL\n"
open(sys.argv[1], "w").write(body)
PY
w big/file.txt "hello"
# Tree b: no CLAUDE.md anywhere, so the AGENTS.md fallback applies.
B="$T/b"; mkdir -p "$B"; (cd "$B" && git init -q)
v() { mkdir -p "$(dirname "$B/$1")"; printf '%s\n' "$2" > "$B/$1"; }
v AGENTS.md "Canary: CNRY-BAGENTS
@notes.md"
v notes.md "Canary: CNRY-BAGENTSIMPORT"
v .claude/AGENTS.md "Canary: CNRY-BDOTAGENTS"
v AGENTS.override.md "Canary: CNRY-BOVERRIDE"
v AGENTS.local.md "Canary: CNRY-BLOCAL"
v .agents/rules/r.md "Canary: CNRY-BAGENTSRULE"
v svc/AGENTS.md "Canary: CNRY-BSVCAGENTS"
v svc/file.txt "hello"
v svc2/AGENTS.md "Canary: CNRY-BSVC2AGENTS"
v svc2/CLAUDE.md "Canary: CNRY-BSVC2CLAUDE"
v svc2/file.txt "hello"
v GEMINI.md "Canary: CNRY-BGEMINI"

#!/bin/sh
# Runs claude -p from several folders of the canary trees and records which canaries it sees.
# Usage: scripts/canary/run.sh <tree folder> <output file>. Compare the output with load_plan for
# the same folders, then record confirmed behaviours in src/load/sources.ts (CANARY_RUNS).
# claude -p cannot answer the external-imports question, so an import outside the start folder never
# loads here unless the project was approved in an interactive session. Check those by hand: start
# claude in the folder, answer the dialog, ask for the canaries, and note the version and the answer.
T=$1; OUT=$2
: > "$OUT"
ASK="Without using any tool, list every token that starts with CNRY- that appears anywhere in your context so far (system prompt, project instructions, rules, memory, skill listings, system reminders). Output only the tokens, one per line, sorted, nothing else. If there are none, output NONE."
run() { # name dir readfile [claude options]
  name=$1; dir=$2; file=$3; shift 3
  if [ -n "$file" ]; then p="First use the Read tool to read the file $file (relative to the current folder). Then, without any other tool call, do this: $ASK"; else p="$ASK"; fi
  res=$(cd "$T/$dir" && claude -p "$p" --allowedTools Read --strict-mcp-config --max-turns 4 "$@" < /dev/null 2>&1 | tr '\n' ' ')
  echo "$name | cwd=$dir | read=${file:--} | $* | $res" >> "$OUT"
}
run a-root a ""
run a-pkg a/pkg ""
run a-pkgsub a/pkg/sub ""
run a-root-read-pkgsub a pkg/sub/file.txt
run a-root-read-pkg a pkg/file.txt
run a-root-read-ts a src/a.ts
run a-root-read-cfg a deep/x/settings.cfg
run a-root-read-big a big/file.txt
run a-root-read-big-haiku a big/file.txt --model haiku
run a-pkg-read-sibling-none a/pkg ""
run b-root b ""
run b-svc b/svc ""
run b-root-read-svc b svc/file.txt
run b-root-read-svc2 b svc2/file.txt
echo "claude $(claude --version) $(date -u +%Y-%m-%d)" >> "$OUT"

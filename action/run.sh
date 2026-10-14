#!/usr/bin/env bash
# Runs the bundled asitis CLI for action.yml. Inputs arrive as INPUT_* environment variables,
# never pasted into the script, so a path or config name cannot inject shell code.
# Writes the step outputs and exits 0 when the lint ran (exit code 0 or 1 goes to the
# exit-code output, and the last step of action.yml fails the job on 1), or exits 2 or 3
# straight away when the run itself failed.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$here/asitis.mjs"
out="${GITHUB_OUTPUT:-/dev/null}"

output() { printf '%s=%s\n' "$1" "$2" >> "$out"; }
fail() {
  # One line, as an error annotation, then exit with the given code.
  printf '::error title=asitis::%s\n' "$2"
  output exit-code "$1"
  exit "$1"
}

# 1. Node 22.13 or later. The runner's own Node is often older, and the CLI is never installed
#    from npm here, so say exactly what to add.
if ! command -v node > /dev/null 2>&1; then
  fail 2 "asitis needs Node 22.13 or later and found no node on PATH. Add actions/setup-node with node-version: 22 (or later) before this step."
fi
nv="$(node --version 2>/dev/null | tr -d '\r')"
major="$(printf '%s' "$nv" | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p')"
minor="$(printf '%s' "$nv" | sed -n 's/^v[0-9][0-9]*\.\([0-9][0-9]*\).*/\1/p')"
if [ -z "$major" ] || [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "${minor:-0}" -lt 13 ]; }; then
  fail 2 "asitis needs Node 22.13 or later and this runner has ${nv:-an unknown version}. Add actions/setup-node with node-version: 22 (or later) before this step."
fi

# 2. Arguments. paths: one per line, or separated by spaces when given on one line.
format="${INPUT_FORMAT:-github}"
case "$format" in
  github | text | json) ;;
  sarif) fail 2 "format sarif is not printed to the log; set the sarif-file input instead." ;;
  *) fail 2 "format must be github, text or json, not \"$format\"." ;;
esac

args=(lint --root "${INPUT_ROOT:-.}")
[ -n "${INPUT_CONFIG:-}" ] && args+=(--config "$INPUT_CONFIG")
[ -n "${INPUT_BASELINE:-}" ] && args+=(--baseline "$INPUT_BASELINE")
[ -n "${INPUT_INCLUDE:-}" ] && args+=(--include "$INPUT_INCLUDE")

paths=()
raw="$(printf '%s' "${INPUT_PATHS:-}" | tr -d '\r')"
if [[ "$raw" == *$'\n'* ]]; then
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] && paths+=("$line")
  done <<< "$raw"
elif [ -n "$raw" ]; then
  read -r -a paths <<< "$raw"
fi

# 3. The lint pass. Its stdout goes to the log, where --format github lines become annotations.
# Its stderr (a one-line reason on exit 2 or 3, or "not linted" lines) is shown as annotations too,
# with % escaped so the text stays data.
log="$(mktemp)"
errlog="$(mktemp)"
node "$cli" "${args[@]}" --format "$format" --fail-on "${INPUT_FAIL_ON:-error}" ${paths[@]+"${paths[@]}"} > "$log" 2> "$errlog"
code=$?
cat "$log"
level=notice
[ "$code" -ge 2 ] && level=error
while IFS= read -r line; do
  [ -n "$line" ] && printf '::%s title=asitis::%s\n' "$level" "$(printf '%s' "$line" | tr -d '\r' | sed 's/%/%25/g')"
done < "$errlog"
rm -f "$errlog"
if [ "$code" -ge 2 ]; then
  rm -f "$log"
  output exit-code "$code"
  exit "$code"
fi

# Counts for the outputs, from the JSON summary or the summary line.
counts="$(node -e '
const t = require("fs").readFileSync(process.argv[1], "utf8");
let s = { errors: 0, warnings: 0, notes: 0 };
if (process.argv[2] === "json") s = JSON.parse(t).summary;
else {
  const m = /Linted [\d,]+ files?: (.*)$/m.exec(t);
  const n = (w) => { const r = new RegExp("([\\d,]+) " + w).exec(m ? m[1] : ""); return r ? Number(r[1].replace(/,/g, "")) : 0; };
  s = { errors: n("error"), warnings: n("warning"), notes: n("note") };
}
process.stdout.write(`${s.errors} ${s.warnings} ${s.notes}`);
' "$log" "$format" 2>/dev/null || echo "0 0 0")"
rm -f "$log"
read -r errors warnings notes <<< "$counts"
output errors "$errors"
output warnings "$warnings"
output notes "$notes"

# 4. SARIF, written to a file for code scanning. --fail-on never: the lint pass decides the exit code.
sarif="${INPUT_SARIF_FILE:-}"
if [ -n "$sarif" ]; then
  mkdir -p "$(dirname "$sarif")" 2>/dev/null
  if ! : > "$sarif" 2>/dev/null; then
    fail 2 "cannot write the SARIF file \"$sarif\"; set sarif-file to a path inside the workspace."
  fi
  node "$cli" "${args[@]}" --format sarif --fail-on never ${paths[@]+"${paths[@]}"} > "$sarif"
  scode=$?
  if [ "$scode" -ne 0 ]; then
    rm -f "$sarif"
    output exit-code "$scode"
    exit "$scode"
  fi
  output sarif-file "$sarif"
else
  output sarif-file ""
fi

output exit-code "$code"
exit 0

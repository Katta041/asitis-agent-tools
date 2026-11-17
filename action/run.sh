#!/usr/bin/env bash
# Runs the bundled asitis CLI for action.yml. Inputs arrive as INPUT_* environment variables,
# never pasted into the script, so a path or config name cannot inject shell code.
# Writes the step outputs and exits 0 when the lint ran (exit code 0, 1 or 4 goes to the
# exit-code output, and the last step of action.yml fails the job on any of them but 0), or exits
# 2 or 3 straight away when the run itself failed. 4 is a partial run: the repo was too big to
# walk in full, the files found are still annotated and in the SARIF file.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$here/asitis.mjs"
out="${GITHUB_OUTPUT:-/dev/null}"

output() { printf '%s=%s\n' "$1" "$2" >> "$out"; }
# Workflow command data: %, CR and LF escaped, so text from an input or a file stays inside one
# annotation and cannot start a second workflow command on a new line.
escape_data() {
  local s="$1"
  s="${s//%/%25}"
  s="${s//$'\r'/%0D}"
  s="${s//$'\n'/%0A}"
  printf '%s' "$s"
}
fail() {
  # One line, as an error annotation, then exit with the given code.
  printf '::error title=asitis::%s\n' "$(escape_data "$2")"
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

# root: annotation and SARIF paths are relative to the checkout, so an absolute root inside
# GITHUB_WORKSPACE is turned into the same folder written relative to it.
root="${INPUT_ROOT:-.}"
ws="${GITHUB_WORKSPACE:-}"
if [ -n "$ws" ] && [[ "$root" == /* ]]; then
  ws="${ws%/}"
  if [ "$root" = "$ws" ]; then
    root="."
  elif [[ "$root" == "$ws"/* ]]; then
    root="${root#"$ws"/}"
  fi
fi

args=(lint --root "$root")
[ -n "${INPUT_CONFIG:-}" ] && args+=(--config "$INPUT_CONFIG")
[ -n "${INPUT_BASELINE:-}" ] && args+=(--baseline "$INPUT_BASELINE")
[ -n "${INPUT_INCLUDE:-}" ] && args+=(--include "$INPUT_INCLUDE")
annotate=()
[ "$format" = github ] && [ "${INPUT_ANNOTATE_NOTES:-false}" = true ] && annotate=(--annotate-notes)
# fail-on-hidden-security (default true): the lint pass exits 1 when .asitisrc.json or the baseline
# hides or lowers a security finding. Only the lint pass gets it; the SARIF pass uses --fail-on never.
# allow-partial (default false): a walk cut at a limit exits 0 or 1 instead of 4.
partial=()
case "${INPUT_ALLOW_PARTIAL:-false}" in
  true) partial=(--allow-partial) ;;
  false) ;;
  *) fail 2 "allow-partial must be true or false, not \"${INPUT_ALLOW_PARTIAL}\"." ;;
esac
hidden=()
case "${INPUT_FAIL_ON_HIDDEN_SECURITY:-true}" in
  true) hidden=(--fail-on-hidden-security) ;;
  false) ;;
  *) fail 2 "fail-on-hidden-security must be true or false, not \"${INPUT_FAIL_ON_HIDDEN_SECURITY}\"." ;;
esac

# paths: one per line whenever the input has a line break (a YAML block always ends in one), so a
# path with spaces works on its own line. A single line is one path when that file exists, and
# otherwise a list separated by spaces. No $(...) here: it would strip the final line break.
paths=()
raw="${INPUT_PATHS:-}"
raw="${raw//$'\r'/}"
trim() {
  local t="$1"
  t="${t#"${t%%[![:space:]]*}"}"
  t="${t%"${t##*[![:space:]]}"}"
  printf '%s' "$t"
}
if [[ "$raw" == *$'\n'* ]]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(trim "$line")"
    [ -n "$line" ] && paths+=("$line")
  done <<< "$raw"
elif [ -n "$(trim "$raw")" ]; then
  one="$(trim "$raw")"
  if [ -e "$one" ]; then
    paths=("$one")
  else
    read -r -a paths <<< "$raw"
  fi
fi

# 3. The lint pass. Its stdout goes to the log, where --format github lines become annotations.
# Its stderr (a one-line reason on exit 2 or 3, or "not linted" lines) is shown as annotations too,
# escaped so the text stays data. "--" ends the options, so a path named "--help" or
# "--fail-on=never" is linted as a path and never read as an option.
log="$(mktemp)"
errlog="$(mktemp)"
node "$cli" "${args[@]}" --format "$format" ${annotate[@]+"${annotate[@]}"} --fail-on "${INPUT_FAIL_ON:-error}" ${hidden[@]+"${hidden[@]}"} ${partial[@]+"${partial[@]}"} -- ${paths[@]+"${paths[@]}"} > "$log" 2> "$errlog"
code=$?
cat "$log"
level=notice
[ "$code" -eq 4 ] && level=warning
[ "$code" -ge 2 ] && [ "$code" -ne 4 ] && level=error
while IFS= read -r line; do
  [ -n "$line" ] && printf '::%s title=asitis::%s\n' "$level" "$(escape_data "$line")"
done < "$errlog"
rm -f "$errlog"
if [ "$code" -ge 2 ] && [ "$code" -ne 4 ]; then
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
  node "$cli" "${args[@]}" --format sarif --fail-on never ${partial[@]+"${partial[@]}"} -- ${paths[@]+"${paths[@]}"} > "$sarif"
  scode=$?
  # 4: the same partial walk as the lint pass; the SARIF file holds what was found.
  if [ "$scode" -ne 0 ] && [ "$scode" -ne 4 ]; then
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

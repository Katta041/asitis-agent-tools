#!/usr/bin/env bash
# Formats tracked Python and TypeScript files. Exits non-zero when a formatter fails.
set -euo pipefail

py_files=$(git ls-files '*.py' | tr '\n' ' ')
ts_files=$(git ls-files '*.ts' '*.tsx' | tr '\n' ' ')

if [ -n "$py_files" ]; then
  ruff format $py_files
fi
if [ -n "$ts_files" ]; then
  npx prettier --write $ts_files | grep -v "unchanged" || true
fi
echo "formatted: $(echo $py_files $ts_files | wc -w | tr -d ' ') files"

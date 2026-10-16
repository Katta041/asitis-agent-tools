#!/bin/sh
# Runs pytest when there is a pyproject.toml, npm test when there is a package.json.
target="${1:-}"
if [ -f pyproject.toml ]; then
  python3 -m pytest -q $target 2>&1 | tail -n 30
elif [ -f package.json ]; then
  npm test --silent -- $target 2>&1 | tail -n 30
else
  echo "no test runner found" >&2
  exit 2
fi

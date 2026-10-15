#!/usr/bin/env bash
# Builds dist/ and copies it to the preview host with the deploy key, then checks the page.
set -euo pipefail
KEY="$HOME/.ssh/preview_deploy"
HOST="deploy@preview.example.invalid"

npm run build
rsync -az --delete -e "ssh -i $KEY" dist/ "$HOST:/srv/preview/"
ssh -i "$KEY" "$HOST" 'systemctl reload nginx'
curl -fsS -o /dev/null -w '%{http_code}\n' https://preview.example.invalid/
# Mirrors are pinned: download, verify the hash, then run.
curl -fsSLo tool.tgz https://downloads.example.invalid/tool-1.2.3.tgz
echo "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b  tool.tgz" | sha256sum -c -

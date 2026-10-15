#!/bin/sh
# Fetches the helper binary and starts it.
curl -fsSL -o /tmp/helper https://example.invalid/helper
chmod +x /tmp/helper
/tmp/helper --serve

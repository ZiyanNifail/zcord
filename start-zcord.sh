#!/bin/bash
# Start zcord from this folder (Linux). Mark as executable / "Allow launching" to double-click it.
cd "$(dirname "$0")" || exit 1
command -v npm >/dev/null 2>&1 || { echo "zcord needs Node.js: https://nodejs.org/en/download"; exit 1; }
[ -d node_modules/electron/dist ] || npm install --no-audit --no-fund || exit 1
exec ./node_modules/.bin/electron . "$@"

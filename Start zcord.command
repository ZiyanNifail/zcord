#!/bin/bash
# Double-click to start zcord from this folder (macOS).
cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display dialog "zcord needs Node.js. Install the LTS version from nodejs.org, then double-click Start zcord again." buttons {"Open nodejs.org"} default button 1 with title "zcord"' >/dev/null 2>&1
  open "https://nodejs.org/en/download"
  exit 1
fi

if [ ! -d node_modules/electron/dist ]; then
  echo "First run: installing zcord. This takes a minute or two..."
  npm install --no-audit --no-fund || { echo "Install failed. Check your internet connection and try again."; read -r -p "Press Enter to close."; exit 1; }
fi

nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
echo "zcord is starting. You can close this window."

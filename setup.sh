#!/usr/bin/env bash
# Verbatim one-time setup for macOS / Linux. Needs Node.js 20+ and Python 3.10-3.13 installed.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Please install Node.js 20+ from https://nodejs.org first."; exit 1; }
if ! command -v ollama >/dev/null; then
  echo "Optional: install Ollama from https://ollama.com for AI insights, then run: ollama pull qwen2.5:7b"
fi
npm install --no-audit --no-fund
npm run setup
echo
echo "Setup finished. Start Verbatim with:  ./start.sh"
echo "IMPORTANT: back up the ENCRYPTION_KEY line from .env - without it, recordings cannot be opened."

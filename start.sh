#!/usr/bin/env bash
# Start Verbatim (macOS / Linux). The browser opens by itself when the app is ready. Ctrl+C stops it.
cd "$(dirname "$0")"
exec node scripts/start.mjs

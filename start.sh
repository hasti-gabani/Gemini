#!/usr/bin/env bash
# Start the development servers (Git Bash / macOS / Linux).
#   ./start.sh            other commands: python scripts/runner.py [stop|status|logs|serve|test]
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python || command -v py)
exec "$PY" scripts/runner.py start

#!/bin/bash
set -e
cd "$(dirname "$0")/.."
exec venv/bin/uvicorn line_claude_bridge:app --host 0.0.0.0 --port 8000

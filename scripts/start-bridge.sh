#!/bin/bash
set -e
uvicorn line_claude_bridge:app --host 0.0.0.0 --port 8000 --reload

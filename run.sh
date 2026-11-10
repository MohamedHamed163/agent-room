#!/usr/bin/env bash
# Starts the Agent Room at http://localhost:8000
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  if command -v uv >/dev/null; then uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
  else python3 -m venv .venv && .venv/bin/pip install -r requirements.txt; fi
fi
[ -f .env ] || cp .env.example .env
exec .venv/bin/uvicorn backend.server:app --host 127.0.0.1 --port "${PORT:-8000}" "$@"

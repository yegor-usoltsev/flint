#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"

docker compose --profile app up -d --wait --build
FLINT_URL=http://localhost:4700 bun run demo

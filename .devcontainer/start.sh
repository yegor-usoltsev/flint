#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/mise/shims:$PATH"

bun run bootstrap --app
DEMO_HEALTH_URL=http://localhost:4700 bun run demo

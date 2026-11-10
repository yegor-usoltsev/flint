#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/mise/shims:$PATH"

cd "$(dirname "$0")/.."
state="$PWD/tmp/dev-server"
mkdir -p "$state"
exec 9>"$state/start.lock"
flock 9

export DEV_SERVER_HOST="${DEV_SERVER_HOST:-$(hostname -I | awk '{print $1}')}"
bun run bootstrap

if flock -n "$state/server.lock" true; then
	nohup setsid flock -n -F "$state/server.lock" bun run dev >>"$state/server.log" 2>&1 </dev/null 9>&- &
	echo "$!" >"$state/server.pid"
fi

deadline=$((SECONDS + 120))
until curl -fsS --max-time 5 http://localhost:4700/api/health >/dev/null 2>&1; do
	if ((SECONDS >= deadline)); then
		tail -80 "$state/server.log"
		echo "Flint did not become healthy at http://localhost:4700/api/health" >&2
		exit 1
	fi
	sleep 1
done

docker compose exec -T gitea curl -fsS --retry 10 --retry-all-errors --retry-delay 1 --max-time 5 http://host-relay:4700/api/health
DEMO_HEALTH_URL=http://localhost:4700 bun run demo

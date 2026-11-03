#!/usr/bin/env bash
set -euo pipefail

curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

origin="https://$CODESPACE_NAME"
domain="$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
sed -e "s|^APP_URL=.*|APP_URL=$origin-4700.$domain|" \
	-e "s|^GITEA_PUBLIC_URL=.*|GITEA_PUBLIC_URL=$origin-4701.$domain|" \
	.env.example >.env

bun install --frozen-lockfile
bun run build

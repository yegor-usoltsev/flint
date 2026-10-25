# Development

## Worktrees

Run `docker compose` only in the main checkout: a second stack would bind the same ports and rewrite `.env.local`. In a worktree, link the env files and install:

```sh
ln -s ../flint/.env ../flint/.env.local .   # paths to the main checkout
bun install
```

`bun test` works there as is: each checkout gets its own test database. A dev server needs a spare port and the host URLs to match it:

```sh
set -a; source .env; set +a
export APP_URL=http://$PUBLIC_HOST:4710
bun run migrate && bun vite dev --port 4710 --host 0.0.0.0
```

It shares the compose database with the main app; for separate data, point `DATABASE_URL` at a throwaway `pgvector/pgvector:pg18` container and run `bun run migrate` and `bun run demo`.

## Signing in on another port

Gitea redirects only to the registered `:4700` callback, so sign in on another port with a session row. The row holds the SHA-256 hex of the cookie token:

```sh
umask 077; T=$(openssl rand -hex 32); H=$(printf %s "$T" | sha256sum | cut -d' ' -f1)
docker exec flint-postgres-1 psql -U flint -d flint -c "insert into sessions (token_hash, user_id, expires_at) select '$H', id, now() + interval '1 day' from users where username = 'alice'"
agent-browser cookies set flint_session "$T" --url http://$PUBLIC_HOST:4710
```

Delete the row (`delete from sessions where token_hash = '<H>'`) when done.

## Releases

Run the manual `bump.yml` workflow on `main`. It sets one version in `package.json` and `cli/package.json`, commits `Release vX.Y.Z`, pushes the tag and starts `release.yml`, which publishes the multi-arch image, the CLI and a GitHub release whose notes list the commits since the previous version and link the packages. Only `bump.yml` starts `release.yml`, so a tag or release made by hand publishes nothing. The repository needs the `DOCKER_PASSWORD` secret; npmjs accepts `release.yml` as a trusted publisher, so it needs no token.

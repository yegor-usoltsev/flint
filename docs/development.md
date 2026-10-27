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

## Failed app loads

If a connection fails or a deployment removes an older tab's JavaScript files, Flint offers Reload. TanStack Router may also reload once for a missing route module. Pending saves, uploads and text that could not reach local storage trigger the browser's unsaved-changes prompt. Restore the connection and finish pending work before reloading; unsaved text returns from the existing local draft storage when storage is available. A failed Mermaid module load can retry on the next render; browsers that retain the failed import still need Reload.

Failed HTTP responses use `Cache-Control: no-store`; existing JavaScript keeps immutable caching. Errors already cached by an older deployment may still need a browser reload or cache clear. Reload warnings cannot guarantee recovery after a browser or OS crash.

## Releases

Run the manual `bump.yml` workflow on `main`. It sets one version in `package.json` and `cli/package.json`, commits `Release vX.Y.Z`, pushes the tag and starts `release.yml`, which publishes the multi-arch image tagged `vX.Y.Z`, `vX.Y`, `vX` and `latest`, the CLI and a GitHub release whose notes list the commits since the previous version and link the packages. Only `bump.yml` starts `release.yml`, so a tag or release made by hand publishes nothing. The repository needs the `DOCKER_PASSWORD` secret; npmjs accepts `release.yml` as a trusted publisher, so it needs no token.

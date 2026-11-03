# Development

## Codespaces

To try a pull request without a local setup, open it in GitHub Codespaces: on the pull request, choose **Code → Codespaces → Create codespace on** its branch. The dev container installs the `mise.toml` tools, builds Flint, starts the compose stack with the `app` profile and runs `bun run demo`, which takes about four minutes. Then open the Flint port (4700) from the **Ports** tab and sign in through Gitea (4701) as `alice` with the password `password`.

Both ports stay private, so only you can open them, signed in to GitHub. The demo checks Flint through `FLINT_URL=http://localhost:4700`, because a private port's public address asks for that GitHub sign-in. After pulling new commits, rerun `bun run build && docker compose --profile app up -d --wait --build`.

Stop or delete the codespace at <https://github.com/codespaces> when done. A stopped codespace keeps its data and starts again in about a minute and a half. In [your Codespaces settings](https://github.com/settings/codespaces), a 30-minute idle timeout and a one-day retention period keep a forgotten codespace from eating the free quota of 60 hours a month on two cores, and from filling its 15 GB of storage. Code from a pull request runs with your repository token inside the codespace, so read a pull request from a fork before opening it there.

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

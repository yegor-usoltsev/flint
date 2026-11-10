# Development

[README.md](../README.md#quick-start) starts the stack and [AGENTS.md](../AGENTS.md) lists checks and conventions. [mise](https://mise.jdx.dev) installs Bun and the pre-commit hook.

## Local bootstrap

`bun run bootstrap` starts PostgreSQL, S3, Gitea, the webhook relay and runner, creates the bucket, demo users and Acme organization, and configures OAuth and the system webhook. It is safe to rerun and leaves existing data intact. Start `bun run dev` separately on the host, then run `bun run demo`. There are no init containers. `bun run bootstrap --storage-only` prepares PostgreSQL and the S3 bucket for tests; after `bun run build`, `bun run bootstrap --app` targets the containerized app instead of the host dev server.

Compose reads OAuth credentials from the owner-only `.env.local` and passes them to the app as environment variables; the container does not mount that file or require the host user’s UID.

Stop `bun run dev` before running `bun run bootstrap --app`, because both servers bind port 4700. To switch back, run `docker compose --profile app stop app`, then `bun run bootstrap` and `bun run dev`.

The `host-relay` container forwards port 4700 to `host.docker.internal:4700`. Gitea rejects OrbStack's reserved host-gateway IP as a webhook destination, so its webhook targets the relay's private Docker address. The app profile targets `app:4700` directly; bootstrap removes the stale webhook when switching modes.

## Worktrees

Only the main checkout runs `bun run bootstrap` (which calls `docker compose`): a second stack would take the same ports and rewrite `.env.local`. A worktree links the main checkout's env files and serves on a free port:

```sh
ln -s ../flint/.env ../flint/.env.local .   # paths to the main checkout
bun install
set -a; . ./.env; set +a
export APP_URL=http://$PUBLIC_HOST:4710
bun run migrate && bun vite dev --port 4710
```

`bun test` works as is, with a database per checkout. The dev server shares the main checkout's database, and Gitea's webhook reaches only port 4700, so Git activity appears only while the main dev server runs. For separate data, export a new database before starting the dev server, then run `bun run demo` with the same environment in a second terminal:

```sh
docker exec flint-postgres-1 createdb -U flint flint_mine
export DATABASE_URL=postgres://flint:flint@localhost:4702/flint_mine
```

Gitea redirects sign-ins only to port 4700, so on another port insert a session for an existing user, such as the demo's `alice`, `bob` or `carol`. The row stores the SHA-256 of the cookie's token:

```sh
umask 077; T=$(openssl rand -hex 32); H=$(printf %s "$T" | sha256sum | cut -d' ' -f1)
docker exec flint-postgres-1 psql -U flint -d "${DATABASE_URL##*/}" -c "insert into sessions (token_hash, user_id, expires_at) select '$H', id, now() + interval '1 day' from users where username = 'alice'"
agent-browser cookies set flint_session "$T" --url http://$PUBLIC_HOST:4710
```

Delete it afterwards with `delete from sessions where token_hash = '<H>'`.

Every checkout, dev server and test run shares the bucket `flint`. The storage sweep only deletes objects under the workspaces of its own database, so a database copied with `createdb -T` would delete the source's newer files: start a server on such a copy with `STORAGE_SWEEP_CRON="0 0 29 2 *"`, and keep tests to keys under their own workspace ids.

## Codespaces

To try a pull request without a local setup, choose **Code → Codespaces → Create codespace** on its branch. In about four minutes the container builds Flint, starts the compose `app` profile and runs the demo; then open port 4700 from **Ports** and sign in as `alice` with the password `password`. After pulling, run `bun install --frozen-lockfile && bun run build && bun run bootstrap --app`.

The ports are private: their URLs need your GitHub sign-in, so the demo checks Flint at `DEMO_HEALTH_URL=http://localhost:4700` instead of `APP_URL`. Pull request code runs with your repository token, so open only pull requests you trust. Stop or delete codespaces at <https://github.com/codespaces>; a short idle timeout and retention period in [your settings](https://github.com/settings/codespaces) keep a forgotten one from using up the free quota.

## Releases

Run the manual `bump.yml` workflow on `main`. It bumps `package.json` and `cli/package.json`, commits `Release vX.Y.Z`, pushes the tag and starts `release.yml`, which publishes the multi-arch image (`vX.Y.Z`, `vX.Y`, `vX`, `latest`), the CLI and a GitHub release listing the commits since the last version. Nothing else starts `release.yml`, so a hand-made tag publishes nothing. Docker Hub needs the `DOCKER_PASSWORD` secret; npm trusts `release.yml` as a publisher.

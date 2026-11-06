# Development

[README.md](../README.md#quick-start) starts the stack and [AGENTS.md](../AGENTS.md) lists checks and conventions. [mise](https://mise.jdx.dev) installs Bun and the pre-commit hook.

## Worktrees

Only the main checkout runs `docker compose`: a second stack would take the same ports and rewrite `.env.local`. A worktree links the main checkout's env files and serves on a free port:

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

## Codespaces

To try a pull request without a local setup, choose **Code → Codespaces → Create codespace** on its branch. In about four minutes the container builds Flint, starts the compose `app` profile and runs the demo; then open port 4700 from **Ports** and sign in as `alice` with the password `password`. After pulling, run `bun install --frozen-lockfile && bun run build && docker compose --profile app up -d --wait --build`.

The ports are private: their URLs need your GitHub sign-in, so the demo checks Flint at `DEMO_HEALTH_URL=http://localhost:4700` instead of `APP_URL`. Pull request code runs with your repository token, so open only pull requests you trust. Stop or delete codespaces at <https://github.com/codespaces>; a short idle timeout and retention period in [your settings](https://github.com/settings/codespaces) keep a forgotten one from using up the free quota.

## Releases

Run the manual `bump.yml` workflow on `main`. It bumps `package.json` and `cli/package.json`, commits `Release vX.Y.Z`, pushes the tag and starts `release.yml`, which publishes the multi-arch image (`vX.Y.Z`, `vX.Y`, `vX`, `latest`), the CLI and a GitHub release listing the commits since the last version. Nothing else starts `release.yml`, so a hand-made tag publishes nothing. Docker Hub needs the `DOCKER_PASSWORD` secret; npm trusts `release.yml` as a publisher.

# Self-hosting

Flint runs as one container next to your Gitea, PostgreSQL and an S3 bucket. The examples use `https://flint.example.com` and `https://gitea.example.com`.

1. **Database.** PostgreSQL 18 with pgvector, for example `pgvector/pgvector:pg18`. The first migration creates the `vector` extension.
2. **Storage.** A bucket and an access key on any S3-compatible service. Flint serves files itself after an access check, so the bucket stays private.
3. **Gitea.** An OAuth2 application and a system webhook, [below](#gitea).
4. **Run** `yusoltsev/flint` (or `ghcr.io/yegor-usoltsev/flint`) with the [variables](../README.md#configuration):

   ```sh
   docker run -d --name flint -p 3000:3000 --env-file flint.env yusoltsev/flint:latest
   ```

   Each start applies pending migrations, then serves on port 3000. `/api/health` answers 200 when PostgreSQL and the bucket are reachable, 503 otherwise.

5. **Reverse proxy.** Terminate TLS and serve HTTP/2: every visible tab holds one event stream, and browsers allow only six HTTP/1.1 connections per host. Do not buffer `/api/v1/workspaces/*/stream`, and keep idle connections open longer than its 5-second pings.

Run one container per database, because live updates reach only the tabs connected to the container that made the change.

**Semantic search.** Set `EMBEDDING_API_KEY` for any OpenAI-compatible `/embeddings` API with a 1024-dimension model (default: OpenRouter with `perplexity/pplx-embed-v1-0.6b`). Issue and page text goes to that provider. After setting the key or changing the model, embed existing content once: `docker exec flint bun dist/embeddings-backfill.js`.

Semantic search ranks embeddings exactly within the current workspace, so its database cost grows with the workspace's embedded content.

## Gitea

The bootstrap script keeps one OAuth2 application named `Flint` with the redirect URI `${APP_URL}/api/auth/callback` and one system webhook to `${APP_URL}/api/webhooks/gitea` (`GITEA_WEBHOOK_URL` overrides it). Run it from a checkout after `bun install`, with a site admin token that has `write:admin` and `write:user`:

```sh
GITEA_URL=https://gitea.example.com GITEA_ADMIN_TOKEN=<token> \
APP_URL=https://flint.example.com GITEA_WEBHOOK_SECRET=<random secret> \
bun run gitea:bootstrap
```

It writes `GITEA_CLIENT_ID` and `GITEA_CLIENT_SECRET` to `.env.local`; copy them into Flint's environment. Gitea shows a client secret only once, so the script recreates the application when `.env.local` lacks it.

By hand instead:

1. Create a confidential OAuth2 application with the redirect URI `https://flint.example.com/api/auth/callback`.
2. Under **Site Administration → Integrations → Webhooks**, add a Gitea webhook to `https://flint.example.com/api/webhooks/gitea` with content type `application/json`, the webhook secret and the events Push, Create, Delete, Pull Request and Status.

In Gitea's `app.ini`, raise `[ui] FEED_MAX_COMMIT_NUM` (Gitea lists only that many commits per push) and add Flint's host to `[security] ALLOWED_HOST_LIST` if it resolves to a private address.

**How links work.** A branch, commit message or pull request (title, body or head branch) that contains a project key such as `ENG-12` or `feature/eng-12-fix` links to the issue, with the pull request's state and the commit statuses any CI reports to Gitea. Every repository on the Gitea instance counts, private ones included, and every workspace member sees the links. Flint never writes to Gitea and never changes an issue's status.

**Keys in Gitea.** To turn `ENG-12` in Gitea into a link to Flint, point repositories' external issue tracker at it. The script takes owners (all their repositories) or single repositories and needs no rerun for new projects. Wrap a key in brackets, as in `[ENG-12]`, to get a link in Gitea; Flint links bare keys in branches, commits and pull request titles. A Gitea repository has either its own issues or an external tracker, so the script hides a repository's existing issues, and Renovate stops keeping its Dependency Dashboard there:

```sh
GITEA_URL=https://gitea.example.com GITEA_ADMIN_TOKEN=<token> \
APP_URL=https://flint.example.com \
bun run gitea:external-tracker acme alice/website
```

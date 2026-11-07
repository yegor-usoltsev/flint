# Self-hosting

Flint runs as one container per database, next to PostgreSQL 18 with pgvector (such as `pgvector/pgvector:pg18`), a private S3-compatible bucket and Gitea:

```sh
docker run -d --name flint -p 3000:3000 --env-file flint.env yusoltsev/flint:latest
```

The image is also on `ghcr.io/yegor-usoltsev/flint`. Each start applies pending migrations (the first creates the `vector` extension), and `/api/health` answers 200 when PostgreSQL and the bucket are reachable, 503 otherwise. It checks them at most once every two seconds, so frequent probes do not run up bucket requests.

Put a reverse proxy in front that terminates TLS and serves HTTP/2, because browsers without SharedWorker open an event stream per visible tab and can exhaust the six HTTP/1.1 connections per host. Do not buffer `/api/v1/workspaces/*/stream`, and keep idle connections open longer than its 5-second pings. Have the proxy send `Strict-Transport-Security: max-age=31536000`, so browsers stop trying plain HTTP after the first visit; add `includeSubDomains` only when every subdomain serves HTTPS.

With an `https` `APP_URL`, the session and sign-in cookies carry the `__Host-` prefix, so a page on a sibling subdomain, such as Gitea's, cannot plant its own session in Flint. A sign-in from before this change keeps working from its old cookie until it expires.

Each account gets about `SEARCH_EMBEDDINGS_PER_MINUTE` query embeddings a minute, after which search falls back to full text until the allowance refills. It can run `UPLOADS_PER_USER` uploads at once, with images resized in turns between accounts, and hold `STREAMS_PER_USER` event streams open, after which new ones answer 429 and retry until one closes. JSON request bodies stop at 4 MB. Flint counts all of this in memory per container, so limit anonymous traffic at the reverse proxy.

Instance admins administer every workspace, including ones created later. Set `INSTANCE_ADMINS` to their Gitea usernames; nobody else becomes one. Flint compares each name with the username an account had at its latest sign-in, so update the list when an admin renames their Gitea account. Without `INSTANCE_ADMINS`, the first account to sign in becomes the only instance admin, so sign in right after deployment, before anyone else on your Gitea can.

## Gitea

Flint needs a Gitea OAuth2 application and a system webhook. From a clone of this repository, after `bun install`, the bootstrap script creates or updates both, using a site admin token with `write:admin` and `write:user`:

```sh
GITEA_URL=https://gitea.example.com GITEA_ADMIN_TOKEN=<token> \
APP_URL=https://flint.example.com GITEA_WEBHOOK_SECRET=<random secret> \
bun run gitea:bootstrap
```

It writes `GITEA_CLIENT_ID` and `GITEA_CLIENT_SECRET` to `.env.local` for you to copy into Flint's environment. Gitea shows a secret only once, so the script recreates the application if `.env.local` lacks it. `GITEA_WEBHOOK_URL` overrides the webhook's target.

By hand, create a confidential OAuth2 application with the redirect URI `https://flint.example.com/api/auth/callback`, and under **Site Administration → Integrations → Webhooks** add a Gitea webhook to `https://flint.example.com/api/webhooks/gitea` with content type `application/json`, your secret and the events Push, Create, Delete, Pull Request and Status.

In Gitea's `app.ini`, raise `[ui] FEED_MAX_COMMIT_NUM` (the local stack uses 50), because a push event carries only that many commits and Flint never sees the rest. If Flint's host resolves to a private address, add it to `[security] ALLOWED_HOST_LIST`, or Gitea refuses to deliver webhooks to it.

### Members

Adding a member looks the username up in Gitea's API without credentials and ties the invite to that account, so only it joins, under whatever name it signs in. If Gitea hides the account from anonymous visitors (`[service] REQUIRE_SIGNIN_VIEW`, or a private or limited profile), only someone who has already signed in to Flint can be added.

Upgrading to migration `0006_invites_by_gitea_id.sql` moves pending invites, which held only a username, into `legacy_invites`; list them with `select w.slug, l.gitea_username, l.role, l.created_at from legacy_invites l join workspaces w on w.id = l.workspace_id;`. Re-inviting each name in Settings › Members ties the invite to that Gitea account.

### How links work

An issue key such as `ENG-12` in a branch name (`feature/eng-12-fix` counts), commit message, or pull request title or body links that item to the issue, with the pull request's state and CI statuses. Flint itself never writes to Gitea or changes an issue's status.

A workspace takes links only from the repositories its admins list under **Settings → General → Gitea repositories** or with `flint workspace update --repos`. An owner such as `acme` covers its public repositories; a private one counts only under its full name, such as `acme/billing`, because every workspace member sees its branch names, commit and pull request titles and CI states. Taking a repository off the list removes its links, and so does a webhook that reports a repository private to a workspace that lists only its owner. The upgrade that introduced the list fills it with the repositories each workspace already had links from; review it, because it may include a repository from outside your organization. Flint learns a repository's visibility from its webhooks, so it treats links from before the upgrade as private until the repository's next one: replacing a full name with its owner before then removes them.

For links back from Gitea, the same admin token sets an external issue tracker on owners (all their current repositories) or single repositories; Gitea then links keys in brackets, such as `[ENG-12]`. This hides a repository's own issues, including Renovate's Dependency Dashboard.

```sh
GITEA_URL=https://gitea.example.com GITEA_ADMIN_TOKEN=<token> \
APP_URL=https://flint.example.com bun run gitea:external-tracker acme alice/website
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `APP_URL` | required | Public origin, such as `https://flint.example.com` |
| `DATABASE_URL` | required | PostgreSQL URL |
| `GITEA_URL` | required | Gitea as Flint's server reaches it |
| `GITEA_PUBLIC_URL` | required | Gitea as browsers reach it |
| `GITEA_CLIENT_ID`, `GITEA_CLIENT_SECRET` | required | OAuth2 application |
| `GITEA_WEBHOOK_SECRET` | required | Webhook secret |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required | Attachment storage |
| `S3_REGION` | `auto` | Bucket region |
| `INSTANCE_ADMINS` | empty | Gitea usernames of the instance admins, separated by commas; when empty, the first account to sign in becomes one |
| `MAX_UPLOAD_BYTES` | `26214400` (25 MB) | Largest attachment, at least 1 MB; Bun caps request bodies at 128 MB |
| `TRASH_RETENTION_DAYS` | `30` | Days before deleted issues and pages are purged |
| `DRAFT_UPLOAD_RETENTION_DAYS` | `30` | Days to keep uploads of a new issue that was never created; browsers keep its draft 30 days regardless |
| `SESSION_LIFETIME_DAYS` | `30` | Days a sign-in lasts |
| `TRASH_PURGE_CRON` | `0 0 * * *` | When the trash is purged |
| `STORAGE_SWEEP_CRON` | `1 0 * * 0` | When orphaned uploads are deleted |
| `EMBEDDING_API_KEY` | empty | Turns on semantic search; issue and page text and search queries go to the provider |
| `EMBEDDING_API_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible `/embeddings` API |
| `EMBEDDING_MODEL` | `perplexity/pplx-embed-v1-0.6b` | Must return 1024 dimensions |
| `EMBEDDING_TIMEOUT_MS` | `30000` | Embeddings request timeout while indexing |
| `SEARCH_EMBEDDING_TIMEOUT_MS` | `1500` | How long search waits for semantic results before returning full-text ones |
| `SEARCH_EMBEDDINGS_PER_MINUTE` | `300` | Query embeddings per account and minute; the search box asks for one per typed character |
| `UPLOADS_PER_USER` | `8` | Uploads an account can run at once; more answer 429 |
| `STREAMS_PER_USER` | `20` | Live-update streams an account can hold open; more answer 429 |
| `PORT` | `3000` | Listening port |

Cron schedules use the container's time zone, UTC unless `TZ` is set. After setting `EMBEDDING_API_KEY` or changing the model, embed existing content once with `docker exec flint bun dist/embeddings-backfill.js`. Semantic ranking is exact, so its cost grows with a workspace's content.

# Flint

Issue tracker and Markdown wiki on TanStack Start and Bun with Gitea sign-in. [README.md](README.md) covers setup, [docs/](docs) self-hosting and development.

## Workflow

- Track deferred work as Flint issues in Backlog with fitting labels, not `.backlog/` files.
- Only the main checkout runs `docker compose up -d --wait` and `bun run dev` (port 4700); worktrees link its `.env` and `.env.local` and use another port ([how](docs/development.md#worktrees)). Gitea users `alice` (admin), `bob` and `carol` have the password `password`; `bun run demo` fills the Acme Corp workspace.
- Browser URLs use `PUBLIC_HOST` from `.env` (default `localhost`); Gitea listens only on `PUBLIC_HOST_BIND`.
- The pre-commit hook runs `bun run lint` (tsc and Ultracite; `bun run lint:fix` fixes) on the whole working tree, so parallel writers need separate worktrees.
- `bun test` needs the compose Postgres and makes a database per checkout. Call `resetDatabase` in `beforeEach`, test routes with `callRoute(Route, request)` from `test/helpers.ts`, and stub Gitea by spying on `fetch`.
- A new endpoint in `src/lib/endpoints.ts` needs an entry in the outsider matrix of `src/server/access.test.ts` (`tsc` enforces it), so every route answers 404 outside the caller's workspaces; add routes outside that map, such as the stream and file routes, to `allCalls` by hand.
- `bun run cli:smoke` drives every CLI command group as alice in `acme/ENG`, against the running app after `bun run demo`.

## Pull requests

- CodeRabbit, cubic and Greptile review every non-draft PR except Renovate's within minutes of each push; CodeRabbit allows about 10 reviews an hour. Wait for CI and the reviews, then read their comments with `gh api --paginate repos/{owner}/{repo}/pulls/<n>/comments`. When CodeRabbit's summary stops short of the latest head, comment `@coderabbitai review`.
- Verify each finding against the code. Fix real defects in one commit per round; decline the rest (nits, style, rules the code already follows, speculation) with one line of evidence and resolve the thread. The bots answer replies, so do not argue twice.
- Stop after two fix rounds, as open nits do not block a merge. Merge with `gh pr merge --squash` once CI is green and no comment shows a real defect.

## Code

- Every product feature is a REST endpoint under `src/routes/api/v1/`, so the CLI can do what the UI does. Add it to `src/lib/endpoints.ts` first, declare the handler with `endpoint<"METHOD /path">` from `src/server/api.server.ts`, and set `ANY: methodNotAllowed`, or other methods fall through to the HTML app.
- Server-only code lives in `*.server.ts`. Services take the `Actor` and validate and authorize through `src/server/access.server.ts`; anything outside the caller's workspaces answers 404, never 403, so its existence does not leak.
- Migrations are new `migrations/NNNN_name.sql` files; never edit an applied one. Env variables go in `src/server/env.server.ts`, `.env.example`, the compose `app` service and the table in `docs/self-hosting.md`.
- Call `publish` from `realtime.server.ts` after the transaction commits, and key issue-derived queries under `["issues", projectId]`. `src/lib/realtime-cache.ts` patches cached rows from the summary in issue update and wiki write events and refetches only queries whose members can change, so a new list kind needs a rule there.
- `cli/` imports only `node:*`, types and pure helpers from `src/lib`. Keep `cli/guide.md`, which `flint skill` prints, in step with the commands.
- Inside `db.begin`, run every query on `tx`, including helpers: a pool query there waits for a free connection while the transaction keeps its locks, so a burst the size of the pool (10) wedges the app. `db.server.ts` sets `lock_timeout` and `idle_in_transaction_session_timeout` so such a wedge ends in errors after seconds.
- Bun SQL encodes `${value}::jsonb` itself, so pass the raw value; pass arrays as `any(${tx.array(ids, "uuid")})`; detect unique violations with `UniqueViolationSchema`.
- `src/lib/markdown.ts` wraps Tiptap's ordered-list tokenizer for letter and Roman markers, start values and mixed `.`/`)` delimiters (normalized to `.`). Keep it re-lexing block-first content and continuation blocks at the full marker-prefix width, keeping initial paragraph text, reusing tokenized nested lists (re-parsing them is exponential) and merging bare markers into the previous item.
- `src/components/media-viewer.tsx` mounts PhotoSwipe inside a Base UI dialog, so it nests above other dialogs and their focus traps. Base UI popups stop arrow-key propagation, so the viewer forwards keys itself; unmount with `dispose`, as `pswp.destroy()` only closes an opening viewer.
- `src/routeTree.gen.ts` is generated.
- Realtime transports deliver `open` through `useRealtime`; keep draft retry and catch-up there, so SharedWorker joins and the direct fallback behave alike. The first `open` refreshes only queries loaded well before the connect, later ones refresh everything, and focus refetches only while the stream is down. Shared tabs stay subscribed while hidden and apply queued events when shown.

## Style

- No code comments except lint suppressions with reasons (`oxlint-disable-next-line <rule> -- <reason>`) and directives that change behavior. Fix a diagnostic before suppressing it; a config override is the last resort. Write components and helpers as arrow functions above their first use.
- UI is shadcn `base-nova` on Base UI: compose with `render`, add with `bunx --bun shadcn@latest add`, and keep edits to `src/components/ui/` small. Lint rejects arbitrary values, so use the tokens and sizes in `src/styles.css` or add a token or `Button` size.
- Change issues only through `useUpdateIssue()` or `writeIssue` from `src/lib/use-update-issue.ts`, whose per-issue queue keeps optimistic edits and conflicts consistent.
- In render, read module state or the query cache through a hook such as `useSyncExternalStore`, because the React Compiler memoizes plain reads.
- Anything the workspace layout mounts imports `LazyMarkdownEditor`, not `MarkdownEditor`, to keep Tiptap out of the main chunk.
- Register shortcuts with `useCommands` or `useHotkey` from `src/lib/use-hotkey.ts` and list new keys in `src/components/shortcuts-dialog.tsx`.
- Every page has zero axe violations (`agent-browser a11y`) in both themes and fits a 393 px phone without horizontal scrolling.
- agent-browser's headless Chrome reports `hover: none`, so `hover:` styles never show there. Reload after editing a route loader, because HMR keeps the old one.

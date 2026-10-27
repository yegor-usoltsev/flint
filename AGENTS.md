# Flint

Issue tracker and Markdown wiki on TanStack Start and Bun, with sign-in through Gitea. [README.md](README.md) covers setup and configuration, [docs/](docs) self-hosting and development details.

## Workflow

- Track deferred work as Flint issues in Backlog with appropriate labels; do not create `.backlog/` files.
- Run `docker compose up -d --wait` and `bun run dev` (port 4700) only in the main checkout; worktrees link its `.env` and `.env.local` and run a dev server on another port ([docs/development.md](docs/development.md)). Gitea users `alice` (admin), `bob` and `carol` have the password `password`; `bun run demo` fills the Acme Corp workspace.
- Browser URLs come from `PUBLIC_HOST` in `.env`; the app and Gitea listen on `PUBLIC_HOST_BIND`, so `localhost` may not answer.
- `bun run lint` (tsc and Ultracite; `lint:fix` fixes) runs in the prek pre-commit hook over the whole working tree, so each parallel writer needs its own worktree.
- `bun test` needs the compose Postgres and gives each checkout its own test database. Call `resetDatabase` in `beforeEach`, test a route with `callRoute(Route, request)` from `test/helpers.ts`, and stub Gitea by spying on `fetch`.
- `bun run cli:smoke` drives every CLI command group against the running app after `bun run demo` (it signs in as alice and uses `acme/ENG`).

## Code

- Every product feature is a REST endpoint under `src/routes/api/v1/`, so the CLI can do what the UI does. Add it to the type map `src/lib/endpoints.ts` first, declare the handler with `endpoint<"METHOD /path">` from `src/server/api.server.ts`, and give the route `ANY: methodNotAllowed`, because an unhandled method falls through to the HTML app.
- Server-only code lives in `*.server.ts`. Services take the `Actor` and own validation and authorization through `src/server/access.server.ts`; a resource outside the caller's workspaces answers 404, never 403, so its existence does not leak.
- Add a migration as a new `migrations/NNNN_name.sql`; never edit an applied one. Add an env variable to `src/server/env.server.ts`, `.env.example`, the compose `app` service and the configuration table in `docs/self-hosting.md`.
- Call `publish` from `realtime.server.ts` after the transaction commits. Give a new issue-derived query a key under `["issues", projectId]`, so SSE events refresh it.
- The CLI in `cli/` imports only `node:*`, types and pure helpers from `src/lib`; `cli/guide.md` is the agent guide `flint skill` prints, so update it with the commands.
- Bun SQL: a `${value}::jsonb` parameter takes the raw JS value, because Bun encodes it; pass arrays as `any(${tx.array(ids, "uuid")})`; detect unique violations with `UniqueViolationSchema`.
- `src/routeTree.gen.ts` is generated.
- Realtime transports deliver `open` through `useRealtime`; keep draft retry and full query catch-up there so SharedWorker joins and direct fallback behave alike.

## Style

- Code carries no comments except lint suppressions with reasons (`oxlint-disable-next-line <rule> -- <reason>`) and behavior-changing directives. Fix a diagnostic before suppressing it; a config override is the last resort. Write components and helpers as arrow functions defined above their first use.
- UI comes from shadcn `base-nova` on Base UI (compose with `render`, add with `bunx --bun shadcn@latest add`); keep edits to `src/components/ui/` small. Use the theme tokens and sizes in `src/styles.css`; add a token or a `Button` size instead of arbitrary values, which lint rejects.
- Change issues only through `useUpdateIssue()` or `writeIssue` in `src/lib/use-update-issue.ts`, whose per-issue queue keeps optimistic edits and conflicts consistent.
- Read module state or the query cache in render through a hook such as `useSyncExternalStore`, because the React Compiler memoizes plain reads.
- Anything the workspace layout mounts imports `LazyMarkdownEditor`, not `MarkdownEditor`, to keep Tiptap out of the main chunk.
- Register shortcuts with `useCommands` or `useHotkey` in `src/lib/use-hotkey.ts` and list new keys in `src/components/shortcuts-dialog.tsx`.
- Every page has zero axe violations (`agent-browser a11y`) in both themes and fits a 393 px phone without horizontal scrolling.
- agent-browser's headless Chrome reports `hover: none`, so `hover:` styles never render there; reload the page after editing route loaders, because HMR keeps the old ones.

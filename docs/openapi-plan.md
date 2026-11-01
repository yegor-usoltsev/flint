# OpenAPI-first API and a Go CLI (FLN-6)

This is a feasibility study. A small vertical slice describes the API in TypeSpec, compiles it to OpenAPI, checks the hand-written TypeScript endpoint map against the generated types, validates real route responses with generated Valibot schemas, and drives a Go CLI built on a generated client. The prototype runs next to the app and changes nothing it ships: the routes, `src/lib/endpoints.ts`, the TypeScript CLI and the CI workflows are untouched.

## Verdict

All four steps work with current, maintained tools, and none of them blocked the slice. The plumbing is not the hard part. Most of the work is describing 58 operations and porting about 3,400 lines of CLI code (plus 750 lines of tests). The main thing that stays manual is server validation: Valibot transforms (`trim`, `toLowerCase`, priority names, the fractional-index check) have no OpenAPI equivalent, so the domain schemas stay hand-written and a contract check guards the overlap. Reaching the ideal state should take roughly 24 to 34 working days: about 9 to 13 for a TypeSpec single source of truth on the TypeScript side, and 15 to 21 for Go CLI parity with release packaging. The two halves are independent; either can ship first.

## What the prototype contains

| Path | Purpose |
| --- | --- |
| `api/main.tsp`, `api/tspconfig.yaml` | TypeSpec for `GET` and `PATCH /issues/{issueKey}`, `GET /projects/{key}/issues`, `POST /issues/{issueKey}/attachments` (multipart) and `GET /workspaces/{slug}/stream` (SSE), with Bearer auth and the `{error: {code, message, current?}}` envelope |
| `api/openapi.yaml` | Generated OpenAPI 3.2 spec, committed |
| `api/redocly.yaml` | Redocly lint config |
| `src/lib/openapi/paths.gen.ts` | `openapi-typescript` types (`paths`, `components`) |
| `src/lib/openapi/valibot/valibot.gen.ts` | `@hey-api/openapi-ts` Valibot schemas |
| `src/lib/openapi/endpoints.ts` | Derives a `"METHOD /path"` map with `Body`, `Query` and `Response` from `paths`, in the same shape as `src/lib/endpoints.ts` |
| `src/lib/openapi/contract.test.ts` | Compile-time check that the hand-written map matches the spec for every operation in it; runtime check of real route responses (200, 404, 401, the 409 conflict) against the generated schemas; a table comparing `UpdateIssueSchema` with the generated schema |
| `cli-go/` | Go module: `internal/api` (oapi-codegen client, `go generate`), `internal/cli` (cobra commands and tests), `cmd/flint-go` |

Commands: `bun run api:build` regenerates the spec, the TypeScript files and the Go client (it needs Go); `bun run api:check` regenerates and fails on a diff; `bun run api:lint` runs Redocly. In `cli-go/`: `go generate ./...`, `go vet ./...`, `go test ./...`, `go build ./cmd/flint-go`.

The Go CLI implements `issue view KEY`, `issue update KEY [-t title] [--priority p] [-a none|<user id>] [--if-version n]` and `issue list -p KEY [-s] [-a] [-l] [--priority] [-q] [--closed] [--limit] [--offset]`. It reads `FLINT_URL` and `FLINT_TOKEN`, or the TypeScript CLI's config file, and follows the same output rules: JSON when `--json` is passed or stdout is not a terminal, error envelopes on stdout in JSON mode, exit code 1 for API errors and 2 for usage errors.

## What worked

- TypeSpec 1.17 (`@typespec/http`, `@typespec/openapi3`, plus `@typespec/sse`, `@typespec/events` and `@typespec/streams` 0.87) is stable and compiles in under a second. Error envelopes, Bearer auth, path, query and multipart parameters, nullable fields and the 201 response all came out right on the first try. Redocly's recommended ruleset passes after adding summaries and a license.
- `openapi-typescript` 7.13 output plugs into the existing design. About 50 lines of type-level code in `src/lib/openapi/endpoints.ts` turn `paths` into `Endpoints`-shaped entries, so the `endpoint<>` helper, `RequestOptions`, `call()` in the CLI and `request()` in the UI could keep working unchanged, with the map derived from the spec instead of written by hand.
- The compile-time contract caught drift: it failed when I made `assigneeId` non-nullable in the generated body and when I added a response field. TypeScript reports the endpoint and the part (`body`, `query`, `response`) but not the field.
- The generated Valibot schemas accepted every real response from the routes, including the 409 body with `current`, which shows the slice's spec is accurate for those operations.
- oapi-codegen v2.8.2 with `output-options.nullable-type: true` generates `nullable.Nullable[T]` for optional nullable fields, so the PATCH body distinguishes absent, `null` and a value. A Go test checks that `-a none --priority high --if-version 3` sends exactly `{"assigneeId":null,"priority":2,"version":3}` and `-t Renamed` sends `{"title":"Renamed"}`.
- Against the running dev app, `flint-go` and `bun cli/flint.ts` printed byte-identical JSON for `issue view`, three `issue list` filter combinations, two 404s and the 409 conflict. `issue update` applied unassign, priority and title changes as expected.
- Go cross-compiles cleanly: stripped `CGO_ENABLED=0` binaries are 7.1 MB (linux/amd64), 6.8 MB (darwin/arm64) and 7.4 MB (windows/amd64). The bundled TypeScript CLI is 100 KB but needs Node 22.12 or later.

## Friction

**TypeSpec and Valibot duplicate each other.** Request constraints exist twice: in `api/main.tsp` (`@maxLength`, `@pattern`, `@minValue`) and in the `*.server.ts` Valibot schemas. OpenAPI cannot express transforms or custom checks, so the generated schemas are only an approximation. The comparison table in the contract test shows two real divergences: `sortKey: "0"` passes the generated regex but fails `isSortKey`, and a 500-character title padded with spaces passes the server (which trims first) but fails the generated `maxLength`. The type-level side is cheap to keep honest: the existing `body(schema)` constraint already requires the schema input to be assignable to the endpoint's body type, so once that type comes from the spec, `tsc` checks every hand-written schema against it.

**Nullable fields and PATCH semantics.** TypeSpec's `@patch` `implicitOptionality` is deprecated, and `MergePatchUpdate<T>` implies `application/merge-patch+json`, which Flint does not use (it also accepts `addLabelIds`, `removeLabelIds` and `version`). An explicit `UpdateIssue` model with optional fields works. By default oapi-codegen emits `*Uuid` with `omitempty`, which cannot send `null`. `nullable-type: true` fixes that, but it also turns every nullable response field into `nullable.Nullable[T]`, which is more verbose to read than a pointer. ogen gives `OptNilUUID` instead, which is also fine.

**Error envelopes.** Each status needs its own `@error` model with `@statusCode`, and the 409 conflict body needs a separate detail model (`IssueConflictDetail`) because `current` differs per resource. With 58 operations, a few templates (`Conflict<Issue>`, `Conflict<Comment>`, `Conflict<WikiPage>`) would keep this short. oapi-codegen turns each status into a `JSON409`-style field on the response struct. For CLI output that does not matter, because the CLI prints the raw body.

**SSE.** Only OpenAPI 3.2 has `itemSchema` for `text/event-stream`. Emitting 3.0 or 3.1 raises `streams-not-supported`, and `#suppress` cannot silence it because the diagnostic points at the `string` intrinsic, so the prototype emits 3.2. TypeSpec models SSE as named events and marks `event` as required, but Flint sends unnamed `data:` lines, which the browser receives through the `message` listener in `realtime-transport.ts`. As a result the spec is slightly wrong about the stream. Naming the events would change every client, so I left the stream as is. None of the generators produces a stream client: oapi-codegen and openapi-typescript ignore `itemSchema`, and the Go side would need a small hand-written SSE reader if the CLI ever streams.

**Multipart uploads.** TypeSpec's `HttpPart<File>` emits `format: binary` in 3.0 and `{}` in 3.1 and 3.2. oapi-codegen then types the file part as `interface{}`; the usable path is `UploadIssueAttachmentWithBodyWithResponse(ctx, key, contentType, io.Reader)` with a `mime/multipart` writer, which is what the TypeScript CLI does with `FormData`. ogen skips the operation entirely ("form content encoding not implemented"). The TypeScript contract maps multipart bodies to `FormData`, so the existing `endpoint<>` typing keeps working.

**Integer enums.** TypeSpec emits a union of integer literals (priority 0 to 4) as `type: number`. openapi-typescript still produces `0 | 1 | 2 | 3 | 4`, but oapi-codegen produced `float32` and ogen `float64`. The prototype adds `@extension("x-go-type", "int")`, which oapi-codegen honors (ogen ignores it).

**Query arrays.** `priority` accepts numbers and names, so it was first written as `(int32 | string)[]`, which oapi-codegen turns into a JSON-union struct with `From…` and `As…` methods for every item. The spec now says `string[]`, which is what goes over the wire. The hand-written `IssueListQuery` says `(number | string)[]`, so the contract test records that one field as known drift. Repeated parameters need `@query(#{ explode: true })` in TypeSpec 1.x.

**Generated-code ergonomics.** oapi-codegen produced 1,667 lines for 5 operations, with a clean `ClientWithResponses` that keeps `Body []byte`. ogen produced 10,900 lines (client and server), validates every response, and fails on values it does not know, so an older CLI would break when the server adds an enum value. Re-encoding decoded Go structs would also drop unknown fields and could change timestamp precision, so the prototype prints the raw response body. Human-readable output will need the structs and should tolerate unknown values. hey-api's Valibot output is good, but it turns `int64` into a `BigInt` transform (the spec uses `integer` for attachment size) and it is not formatted, so it relies on the `*.gen.*` lint ignore. `tsc` still type-checks all generated TypeScript.

**Toolchain coupling.** hey-api and openapi-typescript both load the `typescript` compiler API. The repo still installs TypeScript 6 as `typescript` next to the native TypeScript 7, so both run today. When that package goes away, both generators need another TypeScript install. hey-api is at 0.99 and changes often. Bare relative paths are read as hey-api registry shorthands, so the script passes `./api/openapi.yaml`.

**Go module boundary.** `go:embed` cannot read outside the module directory, so a Go `flint skill` cannot embed `cli/guide.md` from `cli-go/`. Options: move the guide into the Go module, put `go.mod` at the repository root, or copy the guide during `go generate`.

## Options compared

### Source of truth

| Option | Pros | Cons |
| --- | --- | --- |
| A. TypeSpec, then OpenAPI, then generated TS types and Go client (prototype) | Concise and readable; docs and lint come for free; one spec feeds every client | Request constraints duplicated with Valibot; a new tool and language for contributors |
| B. Code-first: build OpenAPI from Valibot (`@valibot/to-json-schema` 1.8) plus a runtime route registry | Server schemas stay the only source of truth | Response types are TypeScript interfaces, not schemas, so all of `api-types.ts` would need to become Valibot; transforms do not convert; `endpoints.ts` is types-only, so a runtime registry is needed; not prototyped |
| C. Hand-written OpenAPI YAML | No new language | About 3 times the size of the TypeSpec for the same slice (834 lines against 307); reviews get harder |
| D. Status quo (TypeScript types shared with a TypeScript CLI) | Zero work; type sharing already works | No language-neutral contract; the CLI needs Node |

### Generators

| Layer | Recommended | Alternative | Why |
| --- | --- | --- | --- |
| TypeScript types | openapi-typescript 7.13 | hey-api `@hey-api/typescript` | The `paths` map carries methods, which `Endpoints` needs; hey-api's per-operation types do not |
| TypeScript runtime schemas | hey-api Valibot plugin 0.99 | none | The only maintained Valibot generator; used in tests only, not on the request path |
| Go client | oapi-codegen v2.8.2 with `nullable-type` | ogen v1.24.0 | Smaller, tolerant decoding, keeps the raw body, supports multipart through `WithBody`, honors `x-go-type` |
| Spec lint | Redocly CLI 2.72 | Spectral 6.17 | Supports 3.2; the recommended ruleset is enough |

### Recommendation

Take option A in two independent tracks. First make TypeSpec the source of truth on the TypeScript side: derive `Endpoints` and the response types from the spec and keep Valibot as hand-written domain validation guarded by contract tests. That pays off even if the CLI stays in TypeScript, because it gives a published, linted API description. Then port the CLI to Go, if a single static binary without Node is worth roughly three weeks. If it is not, the TypeScript CLI keeps working on the derived types without any change.

## Migration plan

| Step | Work | Estimate (days) |
| --- | --- | --- |
| 1 | Land the tooling: a CI step running `bun run api:check` and `bun run api:lint` (it needs `actions/setup-go`), Go formatting and vet in prek, and a rule in `AGENTS.md` that a new endpoint starts in `api/main.tsp` | 1 |
| 2 | Describe all 58 operations, the `/files/{id}` download and the stream in TypeSpec: the 41 types in `api-types.ts`, the 16 JSON request bodies and 3 multipart uploads with their constraints, query objects, error templates per status and conflict type. Split `main.tsp` by resource | 4 to 5 |
| 3 | Replace the hand-written map: `Endpoints` derived from `paths` (`src/lib/openapi/endpoints.ts`), `api-types.ts` re-exporting `components["schemas"]` under the current names so UI imports stay the same. Fix the drift `tsc` finds | 2 to 3 |
| 4 | Server validation: keep domain Valibot schemas, which `endpoint<>` already type-checks against the spec body; add fixture tables comparing each with its generated schema, like `contract.test.ts` | 1 to 2 |
| 5 | Response contract in tests: an optional generated-schema check in `callApi` from `test/helpers.ts`, so every existing route test also validates responses | 1 to 2 |
| 6 | Go CLI core: config and `login`, `.flint.json` lookup and `link`, `FLINT_*` variables, output and exit-code rules, confirmation prompts, stdin and `-F`, the `GET /me` and members/labels/project lookups with caching, the `/files/{id}` download | 3 to 4 |
| 7 | Go CLI commands: about 70 commands across issues, comments, wiki, workspaces, members, labels, tokens and trash, with human renderers (tables, `issue view` layout), bulk updates with bounded parallelism, sequential uploads with partial-failure envelopes, and ports of `branchName` and the checklist helpers with shared fixtures | 7 to 10 |
| 8 | Parity: run `scripts/dev/cli-smoke.ts` with `FLINT_BIN` pointing at the Go binary (it already supports that), port the `cli/flint.test.ts` cases to Go tests, and embed the guide for `flint skill` (move `cli/guide.md` into the Go module or copy it during generation) | 2 to 3 |
| 9 | Release: GoReleaser in `release.yml` for linux, darwin and windows on amd64 and arm64, with checksums and GitHub release assets; version through `-ldflags` from the tag that `bump.yml` creates; keep the npm packages as a wrapper that installs per-platform binaries through `optionalDependencies` so `npm i -g` and `npx` keep working; update `skills/flint/SKILL.md` and the README install steps. The Docker image is unaffected because `.dockerignore` lists only what it ships | 2 to 3 |
| 10 | Retire the TypeScript CLI after one or two releases with both: delete `cli/*.ts`, `cli:build` and the `cli/` import rule in `AGENTS.md`, and update `docs/` | 1 |

Steps 1 to 5 add up to 9 to 13 days and stand alone. Steps 6 to 10 add up to 15 to 21 days and assume steps 1 and 2. The estimates are for one developer who knows the codebase and include review fixes, not calendar time.

## Risks

- Two languages and toolchains to maintain. Contributors need Go for `api:build`, and the pre-commit hook does not check Go until step 1 adds it.
- hey-api is pre-1.0 and both TypeScript generators need the `typescript` compiler API, which the repo keeps only through the TypeScript 6 package.
- oapi-codegen reads 3.1 and 3.2 through kin-openapi and silently ignores keywords it does not know (it skipped `itemSchema`). The slice generated correct code, but new constructs may not.
- Validation stays duplicated, and contract tests only catch the cases their fixtures cover.
- Generated Go structs drop unknown fields. JSON output avoids that by printing the raw body; human output must tolerate new enum values.
- The SSE stream and the file download sit outside `endpoint<>`, so nothing checks them against the spec.
- Agents and scripts rely on the CLI's exact flags, messages and JSON. The parity step is the guard, and the npm wrapper keeps the install path.

## Not verified

- The full spec. Only five operations are described; the estimates for the other 53 are extrapolated from them.
- ogen beyond code generation and `go build`: no requests were sent with it.
- Spectral, the Valibot code-first option (B) and openapi-fetch were not tried.
- Go builds were checked with Go 1.27.3 only (the `go` directive is 1.27.3). Cross-compiled binaries were built but not run on macOS or Windows.
- GoReleaser, the npm wrapper with per-platform binaries and CI changes were not prototyped.
- The Go CLI's human output is indented JSON, not the TypeScript CLI's text layout, and `-a` takes `none` or a user id only, because usernames need the members endpoint, which is outside the slice.

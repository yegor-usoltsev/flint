import { afterEach, expect, jest, spyOn, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { InfiniteData, QueryKey } from "@tanstack/react-query";

import type {
  Comment,
  Issue,
  IssueEvent,
  IssueField,
  IssueSummary,
  RealtimeEvent,
  WikiPage,
  WikiPageSummary,
} from "~/lib/api-types";
import { maxIssueLimit } from "~/lib/endpoints";
import { applyEvents } from "~/lib/realtime-cache";

const bob = { avatarUrl: "", displayName: "Bob", id: "b", username: "bob" };

const row = (id: string, patch: Partial<IssueSummary> = {}): IssueSummary => ({
  assigneeId: null,
  canceledAt: null,
  checklistDone: 0,
  checklistTotal: 0,
  ciState: null,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  creatorId: "u",
  id,
  key: `ENG-${id}`,
  labelIds: [],
  number: 1,
  priority: 0,
  projectId: "p",
  pullRequestState: null,
  sortKey: "a0",
  statusId: "todo",
  title: id,
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
  ...patch,
});

const comment = (id: string, patch: Partial<Comment> = {}): Comment => ({
  author: bob,
  body: id,
  createdAt: `2026-01-01T00:00:0${id}Z`,
  editedAt: null,
  id,
  issueId: "1",
  version: 1,
  viaApi: false,
  ...patch,
});

const page = (
  id: string,
  patch: Partial<WikiPageSummary> = {}
): WikiPageSummary => ({
  id,
  kind: "page",
  path: id,
  revision: 1,
  sortKey: "a0",
  title: id,
  updatedAt: "2026-01-01T00:00:00Z",
  updatedBy: bob,
  ...patch,
});

const edited = (issue: IssueSummary, fields: IssueField[]): RealtimeEvent => ({
  actorId: "b",
  entity: "issue",
  fields,
  id: issue.id,
  issue,
  projectId: "p",
});

const commented = (id: string, issueId = "1"): RealtimeEvent => ({
  entity: "comment",
  id,
  issueId,
  projectId: "p",
});

const body = (summary: WikiPageSummary): WikiPage => ({
  ...summary,
  body: "",
  createdAt: summary.updatedAt,
  workspaceSlug: "acme",
});

const detail = (issue: IssueSummary): Issue => ({
  ...issue,
  deletedAt: null,
  description: "",
  links: [],
});

type Cached =
  | Issue
  | IssueSummary[]
  | InfiniteData<IssueSummary[]>
  | WikiPage
  | WikiPageSummary[]
  | { comments: Comment[]; events: IssueEvent[] };

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) {
    stop();
  }

  spyOn(globalThis, "fetch").mockRestore();
  jest.useRealTimers();
});

const setup = () => {
  const fetched: string[] = [];

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: ({ queryKey }) => {
          fetched.push(JSON.stringify(queryKey));

          return queryClient.getQueryData(queryKey) ?? null;
        },
        retry: false,
        staleTime: Infinity,
      },
    },
  });

  const shown = (queryKey: QueryKey, data: Cached) => {
    queryClient.setQueryData(queryKey, data);
    stops.push(
      new QueryObserver(queryClient, { queryKey }).subscribe(() => {})
    );
  };

  const was = (queryKey: QueryKey) =>
    fetched.includes(JSON.stringify(queryKey));

  return { fetched, queryClient, shown, was };
};

const serve = (answer: (path: string) => Response) => {
  const paths: string[] = [];

  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const path = (
          input instanceof Request ? input.url : input.toString()
        ).replace("/api/v1", "");

        paths.push(path);

        return await Promise.resolve(answer(path));
      },
      { preconnect: fetch.preconnect }
    )
  );

  return paths;
};

test("an edit patches every cached copy and refetches no list", async () => {
  const { fetched, queryClient, shown } = setup();
  const other = detail(row("2"));
  const timeline = { comments: [comment("1")], events: [] };

  shown(["issues", "p"], [row("1"), row("2")]);
  shown(["issues", "p", "closed", []], {
    pageParams: [0],
    pages: [[row("1")]],
  });
  shown(["issues", "p", "detail", "ENG-1"], {
    ...detail(row("1")),
    description: "Body",
  });
  shown(["issues", "p", "detail", "ENG-2"], other);
  shown(["issues", "p", "counts", {}], []);
  shown(["workspaces", "acme", "projects"], []);
  shown(["workspaces", "acme", "labels"], []);
  shown(["timeline", "1"], timeline);

  const paths = serve(() => Response.json([{ id: "e1" }]));

  await applyEvents(queryClient, "acme", [
    edited(row("1", { priority: 2, title: "New", version: 2 }), [
      "priority",
      "title",
    ]),
  ]);

  expect(fetched).toEqual([]);
  expect(paths).toEqual(["/issues/ENG-1/activity"]);
  expect(queryClient.getQueryData(["issues", "p"])).toMatchObject([
    { priority: 2, title: "New", version: 2 },
    { title: "2" },
  ]);
  expect(queryClient.getQueryData(["issues", "p", "closed", []])).toMatchObject(
    { pages: [[{ title: "New" }]] }
  );
  expect(
    queryClient.getQueryData(["issues", "p", "detail", "ENG-1"])
  ).toMatchObject({ description: "Body", title: "New" });
  expect(queryClient.getQueryData(["issues", "p", "detail", "ENG-2"])).toBe(
    other
  );
  expect(queryClient.getQueryData(["timeline", "1"])).toEqual({
    comments: timeline.comments,
    events: [{ id: "e1" }],
  });
});

test("edits in a burst load the activity once at once and once after a gap", async () => {
  jest.useFakeTimers();

  const { queryClient, shown } = setup();

  shown(["timeline", "1"], { comments: [], events: [] });

  const paths = serve(() => Response.json([]));

  const edit = async (version: number) => {
    await applyEvents(queryClient, "acme", [
      edited(row("1", { title: String(version), version }), ["title"]),
    ]);
  };

  await edit(2);
  expect(paths).toHaveLength(1);
  jest.advanceTimersByTime(500);
  await edit(3);
  jest.advanceTimersByTime(500);
  await edit(4);
  expect(paths).toHaveLength(1);
  jest.advanceTimersByTime(1000);
  await Promise.resolve();
  expect(paths).toHaveLength(2);
  jest.advanceTimersByTime(5000);
  expect(paths).toHaveLength(2);
});

test("a scheduled activity load keeps the answer of the one in flight", async () => {
  jest.useFakeTimers();

  const { queryClient, shown } = setup();
  const slow = Promise.withResolvers<Response>();

  shown(["timeline", "1"], { comments: [], events: [] });
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => await slow.promise, {
      preconnect: fetch.preconnect,
    })
  );

  const first = applyEvents(queryClient, "acme", [
    edited(row("1", { title: "2", version: 2 }), ["title"]),
  ]);

  await applyEvents(queryClient, "acme", [
    edited(row("1", { title: "3", version: 3 }), ["title"]),
  ]);
  slow.resolve(Response.json([{ id: "e1" }]));
  await first;
  expect(queryClient.getQueryData(["timeline", "1"])).toMatchObject({
    events: [{ id: "e1" }],
  });
});

test("an older or already applied version leaves the row alone", async () => {
  const { queryClient, shown } = setup();
  const current = row("1", { title: "Newest", version: 3 });

  shown(["issues", "p"], [current]);
  await applyEvents(queryClient, "acme", [
    edited(row("1", { title: "Older", version: 2 }), ["title"]),
    edited(row("1", { title: "Same", version: 3 }), ["title"]),
  ]);

  expect(queryClient.getQueryData(["issues", "p"])).toEqual([current]);
});

test("lists refetch only when the edit can change their members", async () => {
  const { queryClient, shown, was } = setup();

  const lists = {
    assigned: ["issues", "p", "assigned", "me"],
    closed: ["issues", "p", "closed", []],
    counts: ["issues", "p", "counts", { priority: [] }],
    main: ["issues", "p"],
    mine: ["issues", "workspace", "acme", "closed", "mine"],
    priority: ["issues", "p", "filtered", [["priority", "1"]]],
    status: ["issues", "p", "filtered", [["status", "todo"]]],
  };

  for (const queryKey of Object.values(lists)) {
    shown(queryKey, [row("1")]);
  }

  await applyEvents(queryClient, "acme", [
    edited(row("1", { version: 2 }), ["title"]),
  ]);

  expect(Object.values(lists).filter(was)).toEqual([]);

  await applyEvents(queryClient, "acme", [
    edited(row("1", { priority: 1, version: 3 }), ["priority"]),
  ]);

  expect(Object.values(lists).filter(was)).toEqual([lists.priority]);

  await applyEvents(queryClient, "acme", [
    edited(row("1", { statusId: "done", version: 4 }), ["status"]),
  ]);

  expect(Object.values(lists).filter(was)).toEqual([
    lists.closed,
    lists.counts,
    lists.mine,
    lists.priority,
    lists.status,
  ]);

  await applyEvents(queryClient, "acme", [
    edited(row("1", { assigneeId: "me", version: 5 }), ["assignee"]),
  ]);

  expect(was(lists.assigned)).toBe(true);
  expect(was(lists.main)).toBe(false);
});

test("a status change refetches an open list that lacks the issue", async () => {
  const { queryClient, shown, was } = setup();

  shown(["issues", "p"], [row("2")]);
  await applyEvents(queryClient, "acme", [
    edited(row("1", { version: 2 }), ["title"]),
  ]);
  expect(was(["issues", "p"])).toBe(false);
  await applyEvents(queryClient, "acme", [
    edited(row("1", { statusId: "doing", version: 3 }), ["status"]),
  ]);
  expect(was(["issues", "p"])).toBe(true);
});

test("a full list refetches when a move or status change can shift its cut", async () => {
  const { queryClient, shown, was } = setup();

  const rows = Array.from({ length: maxIssueLimit }, (_, index) =>
    row(String(index))
  );

  shown(["issues", "p"], rows);
  await applyEvents(queryClient, "acme", [
    edited(row("1", { title: "x", version: 2 }), ["title"]),
  ]);
  expect(was(["issues", "p"])).toBe(false);
  await applyEvents(queryClient, "acme", [
    edited(row("1", { sortKey: "b0", version: 3 }), []),
  ]);
  expect(was(["issues", "p"])).toBe(true);
});

test("a description edit refetches only the shown detail of that issue", async () => {
  const { queryClient, shown, was } = setup();

  shown(["issues", "p"], [row("1")]);
  shown(["issues", "p", "detail", "ENG-1"], detail(row("1")));
  shown(["issues", "p", "detail", "ENG-2"], detail(row("2")));
  serve(() => Response.json([]));
  await applyEvents(queryClient, "acme", [
    edited(row("1", { checklistTotal: 1, version: 2 }), ["description"]),
  ]);

  expect(was(["issues", "p", "detail", "ENG-1"])).toBe(true);
  expect(was(["issues", "p", "detail", "ENG-2"])).toBe(false);
  expect(was(["issues", "p"])).toBe(false);
  expect(queryClient.getQueryData(["issues", "p"])).toMatchObject([
    { checklistTotal: 1 },
  ]);
});

test("creates, deletes and restores refetch the project lists and counters", async () => {
  const { queryClient, shown, was } = setup();

  shown(["issues", "p"], [row("2")]);
  shown(["issues", "p", "counts", {}], []);
  shown(["issues", "p", "detail", "ENG-1"], detail(row("1")));
  shown(["issues", "p", "detail", "ENG-2"], detail(row("2")));
  shown(["issues", "other"], [row("3")]);
  shown(["workspaces", "acme", "projects"], []);
  shown(["workspaces", "acme", "projects", "counts"], []);
  shown(["workspaces", "acme", "labels", "counts"], []);
  shown(["workspaces", "acme", "trash"], []);
  await applyEvents(queryClient, "acme", [
    { entity: "issue", id: "1", projectId: "p" },
  ]);

  for (const queryKey of [
    ["issues", "p"],
    ["issues", "p", "counts", {}],
    ["issues", "p", "detail", "ENG-1"],
    ["workspaces", "acme", "projects", "counts"],
    ["workspaces", "acme", "labels", "counts"],
    ["workspaces", "acme", "trash"],
  ]) {
    expect(was(queryKey)).toBe(true);
  }

  expect(was(["issues", "p", "detail", "ENG-2"])).toBe(false);
  expect(was(["issues", "other"])).toBe(false);
  expect(was(["workspaces", "acme", "projects"])).toBe(false);
});

test("a list that is loading refetches instead of keeping its older answer", async () => {
  const { queryClient } = setup();
  const answers = [[row("1")], [row("1", { title: "New", version: 2 })]];
  const first = Promise.withResolvers<null>();

  stops.push(
    new QueryObserver(queryClient, {
      queryFn: async () => {
        const answer = answers.shift();

        if (answers.length === 1) {
          await first.promise;
        }

        return answer;
      },
      queryKey: ["issues", "p"],
    }).subscribe(() => {})
  );

  const applied = applyEvents(queryClient, "acme", [
    edited(row("1", { title: "New", version: 2 }), ["title"]),
  ]);

  first.resolve(null);
  await applied;
  expect(answers).toEqual([]);
  expect(queryClient.getQueryData(["issues", "p"])).toMatchObject([
    { title: "New" },
  ]);
});

test("comment events patch a shown timeline and skip hidden ones", async () => {
  const { queryClient, shown, was } = setup();
  const answers = new Map<string, Response>();

  shown(["timeline", "1"], {
    comments: [comment("1"), comment("3")],
    events: [],
  });
  queryClient.setQueryData(["timeline", "2"], { comments: [], events: [] });

  const paths = serve((path) => answers.get(path) ?? Response.json(null));

  answers.set("/comments/2", Response.json(comment("2")));
  answers.set(
    "/comments/3",
    Response.json(comment("3", { body: "edited", version: 2 }))
  );
  answers.set(
    "/comments/1",
    Response.json(
      { error: { code: "not_found", message: "Gone" } },
      { status: 404 }
    )
  );
  await applyEvents(queryClient, "acme", [
    commented("2"),
    commented("3"),
    commented("1"),
    commented("9", "2"),
  ]);

  expect(paths.toSorted()).toEqual([
    "/comments/1",
    "/comments/2",
    "/comments/3",
  ]);
  expect(queryClient.getQueryData(["timeline", "1"])).toMatchObject({
    comments: [{ id: "2" }, { body: "edited", id: "3" }],
  });
  expect(was(["timeline", "1"])).toBe(false);
  expect(queryClient.getQueryState(["timeline", "2"])?.isInvalidated).toBe(
    true
  );
});

test("the newest request for a comment wins over a slower older one", async () => {
  const { queryClient, shown } = setup();
  const slow = Promise.withResolvers<Response>();
  let calls = 0;

  shown(["timeline", "1"], { comments: [], events: [] });
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        calls += 1;

        return calls === 1
          ? await slow.promise
          : Response.json(comment("1", { body: "new", version: 2 }));
      },
      { preconnect: fetch.preconnect }
    )
  );

  const event: RealtimeEvent = {
    entity: "comment",
    id: "1",
    issueId: "1",
    projectId: "p",
  };

  const first = applyEvents(queryClient, "acme", [event]);

  await applyEvents(queryClient, "acme", [event]);
  slow.resolve(Response.json(comment("1", { body: "old" })));
  await first;
  expect(queryClient.getQueryData(["timeline", "1"])).toMatchObject({
    comments: [{ body: "new" }],
  });
});

test("a patch keeps a pending refetch of a hidden detail", async () => {
  const { queryClient } = setup();
  const key = ["issues", "p", "detail", "ENG-1"];

  queryClient.setQueryData(key, detail(row("1")));
  await applyEvents(queryClient, "acme", [
    edited(row("1", { version: 2 }), ["description"]),
  ]);
  await applyEvents(queryClient, "acme", [
    edited(row("1", { title: "New", version: 3 }), ["title"]),
  ]);

  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryData(key)).toMatchObject({ title: "New" });
});

test("an activity answer older than a finished full fetch refetches instead", async () => {
  const { queryClient, shown, was } = setup();
  const slow = Promise.withResolvers<Response>();

  shown(["timeline", "1"], { comments: [], events: [] });
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => await slow.promise, {
      preconnect: fetch.preconnect,
    })
  );

  const applied = applyEvents(queryClient, "acme", [
    edited(row("1", { title: "New", version: 2 }), ["title"]),
  ]);

  queryClient.setQueryData(
    ["timeline", "1"],
    { comments: [], events: [{ id: "newer" }] },
    { updatedAt: Date.now() + 1 }
  );
  slow.resolve(Response.json([{ id: "older" }]));
  await applied;
  expect(was(["timeline", "1"])).toBe(true);
  expect(queryClient.getQueryData(["timeline", "1"])).toMatchObject({
    events: [{ id: "newer" }],
  });
});

test("wiki content edits patch the tree and refetch only that page", async () => {
  const { queryClient, shown, was } = setup();

  shown(["wiki", "acme", "pages"], [page("a"), page("b")]);
  shown(["wiki", "acme", "page", "a"], body(page("a")));
  shown(["wiki", "acme", "page", "b"], body(page("b")));
  await applyEvents(queryClient, "acme", [
    {
      entity: "wiki",
      id: "a",
      page: page("a", { revision: 2, title: "Renamed" }),
      projectId: null,
    },
  ]);

  expect(was(["wiki", "acme", "pages"])).toBe(false);
  expect(was(["wiki", "acme", "page", "a"])).toBe(true);
  expect(was(["wiki", "acme", "page", "b"])).toBe(false);
  expect(queryClient.getQueryData(["wiki", "acme", "pages"])).toMatchObject([
    { revision: 2, title: "Renamed" },
    { title: "b" },
  ]);

  await applyEvents(queryClient, "acme", [
    { entity: "wiki", id: "c", page: page("c"), projectId: null },
  ]);
  expect(was(["wiki", "acme", "pages"])).toBe(true);
});

test("wiki moves and deletes refetch the whole wiki", async () => {
  const { queryClient, shown, was } = setup();

  shown(["wiki", "acme", "pages"], [page("a")]);
  shown(["wiki", "acme", "page", "b"], body(page("b")));
  await applyEvents(queryClient, "acme", [
    { entity: "wiki", id: "a", projectId: null },
  ]);
  expect(was(["wiki", "acme", "pages"])).toBe(true);
  expect(was(["wiki", "acme", "page", "b"])).toBe(true);
});

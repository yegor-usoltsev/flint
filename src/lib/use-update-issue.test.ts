import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { toast } from "~/components/ui/toast";
import type { Issue, IssueSummary } from "~/lib/api-types";
import {
  hasPendingIssueWrites,
  writeIssue,
  writeIssues,
} from "~/lib/use-update-issue";

const issue = (id: string, statusId: string): Issue => ({
  assigneeId: null,
  canceledAt: null,
  checklistDone: 0,
  checklistTotal: 0,
  ciState: null,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  creatorId: "u",
  deletedAt: null,
  description: "",
  id,
  key: `ENG-${id}`,
  labelIds: [],
  links: [],
  number: 1,
  priority: 0,
  projectId: "p",
  pullRequestState: null,
  sortKey: "a0",
  statusId,
  title: id,
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
});

const BodySchema = v.object({
  statusId: v.optional(v.string()),
  version: v.optional(v.number()),
});

const bodyOf = async (init?: RequestInit) =>
  v.parse(BodySchema, await new Response(init?.body).json());

const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();

const deferred = () => {
  const { promise, resolve } = Promise.withResolvers<Response>();

  return { promise, resolve };
};

const settle = async () => {
  while (hasPendingIssueWrites()) {
    // oxlint-disable-next-line no-await-in-loop -- Polls until the queue drains.
    await Bun.sleep(1);
  }
};

const setup = (issues: Issue[]) => {
  const queryClient = new QueryClient();

  queryClient.setQueryData(["issues", "p"], issues);

  const statuses = () =>
    Object.fromEntries(
      (queryClient.getQueryData<IssueSummary[]>(["issues", "p"]) ?? []).map(
        (item) => [item.id, item.statusId]
      )
    );

  return { queryClient, statuses };
};

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
  spyOn(toast, "add").mockRestore();
});

describe("issue writes", () => {
  test("a failed write rolls back only its own issue", async () => {
    const a = { ...issue("1", "todo"), assigneeId: "u" };
    const b = issue("2", "todo");
    const { queryClient, statuses } = setup([a, b]);
    const assignedKey = ["issues", "p", "assigned", "u"];

    queryClient.setQueryData(assignedKey, [a]);

    const answers = new Map([
      ["1", deferred()],
      ["2", deferred()],
    ]);

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) =>
          await (answers.get(urlOf(input).split("-").at(-1) ?? "")?.promise ??
            Promise.reject(new Error("unexpected"))),
        { preconnect: fetch.preconnect }
      )
    );

    writeIssue(queryClient, a, { statusId: "doing" });
    writeIssue(queryClient, b, { statusId: "done" });
    expect(queryClient.getQueryData(assignedKey)).toMatchObject([
      { id: a.id, statusId: "doing" },
    ]);
    answers
      .get("2")
      ?.resolve(Response.json({ ...b, statusId: "done", version: 2 }));
    await Bun.sleep(1);
    answers.get("1")?.resolve(
      Response.json(
        { error: { code: "internal", message: "boom" } },
        {
          status: 500,
        }
      )
    );
    await settle();

    expect(statuses()).toEqual({ "1": "todo", "2": "done" });
    expect(queryClient.getQueryData(assignedKey)).toMatchObject([
      { id: a.id, statusId: "todo" },
    ]);
  });

  test("writes to one issue reach the server in order", async () => {
    const a = issue("1", "todo");
    const { queryClient, statuses } = setup([a]);
    const sent: string[] = [];
    let version = 1;

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const { statusId = "" } = await bodyOf(init);

          sent.push(statusId);
          await Bun.sleep(statusId === "doing" ? 20 : 1);
          version += 1;

          return Response.json({ ...a, statusId, version });
        },
        { preconnect: fetch.preconnect }
      )
    );

    writeIssue(queryClient, a, { statusId: "doing" });
    writeIssue(queryClient, a, { statusId: "done" });

    expect(statuses()).toEqual({ "1": "done" });
    await Bun.sleep(5);
    expect(statuses()).toEqual({ "1": "done" });
    await settle();

    expect(sent).toEqual(["doing", "done"]);
    expect(statuses()).toEqual({ "1": "done" });
  });

  test("a version conflict on untouched fields retries on the new version", async () => {
    const a = { ...issue("1", "todo"), description: "old" };
    const { queryClient } = setup([a]);
    const versions: unknown[] = [];

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = await bodyOf(init);

          versions.push(body.version);

          return await Promise.resolve(
            body.version === 1
              ? Response.json(
                  {
                    error: {
                      code: "conflict",
                      current: { ...a, statusId: "doing", version: 2 },
                      message: "stale",
                    },
                  },
                  { status: 409 }
                )
              : Response.json({ ...a, description: "new", version: 3 })
          );
        },
        { preconnect: fetch.preconnect }
      )
    );

    let conflict: Issue | undefined;

    writeIssue(
      queryClient,
      a,
      { description: "new" },
      {
        expect: { description: "old" },
        onConflict: (current) => {
          conflict = current;
        },
      }
    );
    await settle();

    expect(versions).toEqual([1, 2]);
    expect(conflict).toBeUndefined();
  });

  test("a draft based on an older description conflicts without a request", async () => {
    const a = { ...issue("1", "todo"), description: "theirs", version: 3 };
    const { queryClient } = setup([a]);
    const fetches = spyOn(globalThis, "fetch");
    let conflict: Issue | undefined;

    writeIssue(
      queryClient,
      a,
      { description: "mine" },
      {
        expect: { description: "original" },
        onConflict: (current) => {
          conflict = current;
        },
      }
    );
    await settle();

    expect(fetches).not.toHaveBeenCalled();
    expect(conflict?.description).toBe("theirs");
  });

  test("text edits to two fields behind a pending write are both acknowledged", async () => {
    const a = { ...issue("1", "todo"), description: "old" };
    const { queryClient } = setup([a]);
    const first = deferred();
    let version = 1;

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const patch = v.parse(
            v.record(v.string(), v.unknown()),
            await new Response(init?.body).json()
          );

          if (version === 1) {
            await first.promise;
          }

          version += 1;

          return Response.json({ ...a, ...patch, version });
        },
        { preconnect: fetch.preconnect }
      )
    );

    const saved: string[] = [];

    writeIssue(queryClient, a, { statusId: "doing" });
    writeIssue(
      queryClient,
      a,
      { title: "new title" },
      {
        expect: { title: a.title },
        onSaved: (current) => {
          saved.push(current.title);
        },
      }
    );
    writeIssue(
      queryClient,
      a,
      { description: "new" },
      {
        expect: { description: "old" },
        onSaved: (current) => {
          saved.push(current.description);
        },
      }
    );
    first.resolve(Response.json({ ...a, statusId: "doing", version: 2 }));
    await settle();

    expect(saved).toEqual(["new title", "new"]);
  });

  test("bulk writes run four at a time and report failures in one toast", async () => {
    const issues = ["1", "2", "3", "4", "5", "6"].map((id) =>
      issue(id, "todo")
    );

    const { queryClient, statuses } = setup(issues);
    const toasts: Parameters<typeof toast.add>[0][] = [];
    let running = 0;
    let peak = 0;

    spyOn(toast, "add").mockImplementation((options) => {
      toasts.push(options);

      return "toast";
    });

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const id = urlOf(input).split("-").at(-1) ?? "";
          const { statusId = "" } = await bodyOf(init);

          running += 1;
          peak = Math.max(peak, running);
          await Bun.sleep(2);
          running -= 1;

          return ["2", "5"].includes(id)
            ? Response.json(
                { error: { code: "internal", message: "boom" } },
                { status: 500 }
              )
            : Response.json({ ...issue(id, statusId), version: 2 });
        },
        { preconnect: fetch.preconnect }
      )
    );

    writeIssues(
      queryClient,
      issues.map((item) => ({ issue: item, patch: { statusId: "done" } }))
    );
    await settle();

    expect(peak).toBe(4);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.title).toBe("Could not update 2 issues");
    expect(statuses()).toEqual({
      "1": "done",
      "2": "todo",
      "3": "done",
      "4": "done",
      "5": "todo",
      "6": "done",
    });
  });

  test("label changes send deltas and keep a label someone else added", async () => {
    const a = issue("1", "todo");
    const { queryClient } = setup([a]);
    const bodies: unknown[] = [];
    let labelIds = ["theirs"];
    let version = 1;

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = v.parse(
            v.object({
              addLabelIds: v.optional(v.array(v.string()), []),
              removeLabelIds: v.optional(v.array(v.string()), []),
            }),
            await new Response(init?.body).json()
          );

          bodies.push(body);
          await Bun.sleep(5);
          labelIds = [
            ...labelIds.filter((id) => !body.removeLabelIds.includes(id)),
            ...body.addLabelIds,
          ];
          version += 1;

          return Response.json({ ...a, labelIds, version });
        },
        { preconnect: fetch.preconnect }
      )
    );

    writeIssue(queryClient, a, { addLabelIds: ["ops"] });
    writeIssue(queryClient, a, { addLabelIds: ["bug"] });

    const labels = () =>
      queryClient.getQueryData<IssueSummary[]>(["issues", "p"])?.[0]?.labelIds;

    expect(labels()).toEqual(["ops", "bug"]);
    await settle();

    expect(bodies).toEqual([
      { addLabelIds: ["ops"], removeLabelIds: [] },
      { addLabelIds: ["bug"], removeLabelIds: [] },
    ]);
    expect(labels()).toEqual(["theirs", "ops", "bug"]);
  });
});

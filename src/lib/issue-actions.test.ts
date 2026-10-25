import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { toast } from "~/components/ui/toast";
import type { Issue, IssueSummary } from "~/lib/api-types";
import { deleteIssues } from "~/lib/issue-actions";
import { hasPendingIssueWrites, writeIssue } from "~/lib/use-update-issue";

const base: Issue = {
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
  id: "1",
  key: "ENG-1",
  labelIds: [],
  links: [],
  number: 1,
  priority: 0,
  projectId: "p",
  pullRequestState: null,
  sortKey: "a0",
  statusId: "todo",
  title: "One",
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
};

const settle = async () => {
  while (hasPendingIssueWrites()) {
    // oxlint-disable-next-line no-await-in-loop -- Polls until the queue drains.
    await Bun.sleep(1);
  }
};

const serve = (initial: Issue) => {
  let server = initial;
  const sent: string[] = [];

  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";

        const path = new URL(
          input instanceof Request ? input.url : input.toString(),
          "http://flint.test"
        ).pathname;

        sent.push(`${method} ${path}`);

        if (method === "PATCH") {
          await Bun.sleep(20);
          server = {
            ...server,
            ...v.parse(
              v.object({ statusId: v.string() }),
              await new Response(init?.body).json()
            ),
            version: server.version + 1,
          };
        } else if (method === "DELETE") {
          if (server.deletedAt !== null) {
            return Response.json(
              {
                error: {
                  code: "deleted",
                  current: server,
                  message: `${server.key} is already deleted`,
                },
              },
              { status: 409 }
            );
          }

          server = { ...server, deletedAt: "now", version: server.version + 1 };
        } else if (path.endsWith("/restore") && server.deletedAt !== null) {
          server = { ...server, deletedAt: null, version: server.version + 1 };
        }

        return Response.json(server);
      },
      { preconnect: fetch.preconnect }
    )
  );

  return { sent, server: () => server };
};

const collectToasts = () => {
  const toasts: Parameters<typeof toast.add>[0][] = [];

  spyOn(toast, "add").mockImplementation((options) => {
    toasts.push(options);

    return "toast";
  });
  spyOn(toast, "close").mockImplementation(() => {
    // Toasts are not rendered in tests.
  });

  return toasts;
};

const undo = (toasts: Parameters<typeof toast.add>[0][]) => {
  const onClick = toasts[0]?.actionProps?.onClick;

  // SAFETY: notifyWithAction's handler never reads its event.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Tests have no DOM event to pass.
  onClick?.({} as Parameters<NonNullable<typeof onClick>>[0]);
};

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
  spyOn(toast, "add").mockRestore();
  spyOn(toast, "close").mockRestore();
});

describe("issue deletion", () => {
  test("a delete waits for a pending edit, and Undo keeps the edit", async () => {
    const queryClient = new QueryClient();
    const { sent, server } = serve(base);
    const toasts = collectToasts();

    queryClient.setQueryData(["issues", "p"], [base]);
    writeIssue(queryClient, base, { statusId: "doing" });

    const deleting = deleteIssues(queryClient, [base]);

    await Bun.sleep(1);
    expect(queryClient.getQueryData<IssueSummary[]>(["issues", "p"])).toEqual(
      []
    );
    expect(sent).toEqual(["PATCH /api/v1/issues/ENG-1"]);
    await deleting;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.title).toBe("Deleted ENG-1");

    undo(toasts);
    await Bun.sleep(1);
    await settle();

    expect(sent.slice(0, 3)).toEqual([
      "PATCH /api/v1/issues/ENG-1",
      "DELETE /api/v1/issues/ENG-1",
      "POST /api/v1/issues/ENG-1/restore",
    ]);
    expect(server()).toMatchObject({ deletedAt: null, statusId: "doing" });
  });

  test("deleting an issue someone already deleted hides it without Undo or error", async () => {
    const queryClient = new QueryClient();
    const { sent } = serve({ ...base, deletedAt: "earlier", version: 2 });
    const toasts = collectToasts();

    queryClient.setQueryData(["issues", "p"], [base]);
    await deleteIssues(queryClient, [base]);
    await settle();

    expect(sent).toContain("DELETE /api/v1/issues/ENG-1");
    expect(toasts).toEqual([]);
    expect(queryClient.getQueryData<IssueSummary[]>(["issues", "p"])).toEqual(
      []
    );
  });

  test("a delete that fails offline brings the row back at once", async () => {
    const queryClient = new QueryClient();
    const toasts = collectToasts();

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => await Promise.reject(new TypeError("Failed to fetch")),
        { preconnect: fetch.preconnect }
      )
    );

    queryClient.setQueryData(["issues", "p"], [base]);
    await deleteIssues(queryClient, [base]);

    expect(queryClient.getQueryData<IssueSummary[]>(["issues", "p"])).toEqual([
      base,
    ]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.title).toBe("Could not delete ENG-1");
  });
});

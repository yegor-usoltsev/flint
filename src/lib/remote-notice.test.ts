import { afterEach, beforeEach, expect, jest, spyOn, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { toast } from "~/components/ui/toast";
import type { Issue, Member } from "~/lib/api-types";
import { membersQuery } from "~/lib/queries";
import { noticeOffscreen } from "~/lib/remote-notice";

const browser = {
  CSS: { escape: (value: string) => value },
  DOMRect: class {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;

    constructor(x: number, y: number, width: number, height: number) {
      this.left = x;
      this.top = y;
      this.right = x + width;
      this.bottom = y + height;
    }
  },
  document: {
    querySelector: () => ({
      getBoundingClientRect: () => new browser.DOMRect(0, 2000, 100, 30),
      parentElement: null,
    }),
  },
  localStorage: { getItem: () => null },
  window: { innerHeight: 800, innerWidth: 1200 },
};

const descriptors = new Map<string, PropertyDescriptor | undefined>();

const issue = (id: string): Issue => ({
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
  statusId: "todo",
  title: id,
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
});

const member = (userId: string, displayName: string): Member => ({
  avatarUrl: "",
  displayName,
  joinedAt: "2026-01-01T00:00:00Z",
  pending: false,
  role: "member",
  userId,
  username: userId,
});

const setup = () => {
  const queryClient = new QueryClient();

  queryClient.setQueryData(["issues", "p"], [issue("1"), issue("2")]);
  new QueryObserver(queryClient, {
    queryFn: () => [issue("1"), issue("2")],
    queryKey: ["issues", "p"],
    staleTime: Number.POSITIVE_INFINITY,
  }).subscribe(() => {});
  queryClient.setQueryData(membersQuery("acme").queryKey, [
    member("bob", "Bob Chen"),
    member("carol", "Carol Diaz"),
  ]);

  return queryClient;
};

const change = (
  queryClient: QueryClient,
  id: string,
  actorId: string,
  before = "todo"
) => {
  noticeOffscreen({
    actors: new Map([[id, new Set([actorId])]]),
    before: new Map([[id, before]]),
    queryClient,
    slug: "acme",
  });
};

beforeEach(() => {
  jest.useFakeTimers();

  for (const [name, value] of Object.entries(browser)) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
});

afterEach(() => {
  jest.useRealTimers();

  for (const [name, descriptor] of descriptors) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }
});

test("ongoing changes do not postpone the off-screen notice", () => {
  const queryClient = setup();
  const add = spyOn(toast, "add").mockReturnValue("t");

  change(queryClient, "1", "bob");
  jest.advanceTimersByTime(800);
  change(queryClient, "2", "bob");
  jest.advanceTimersByTime(400);

  expect(add).toHaveBeenCalledTimes(1);
  expect(add.mock.calls[0]?.[0].title).toBe("Bob Chen updated 2 issues");
  add.mockRestore();
});

test("a later edit by another teammate is not credited with the move", () => {
  const queryClient = setup();
  const add = spyOn(toast, "add").mockReturnValue("t");

  change(queryClient, "1", "bob", "backlog");
  change(queryClient, "1", "carol");
  jest.advanceTimersByTime(1200);

  expect(add.mock.calls[0]?.[0].title).toBe("ENG-1 changed");
  add.mockRestore();
});

test("two teammates in one realtime batch are not merged into one name", () => {
  const queryClient = setup();
  const add = spyOn(toast, "add").mockReturnValue("t");

  noticeOffscreen({
    actors: new Map([["1", new Set(["bob", "carol"])]]),
    before: new Map([["1", "backlog"]]),
    queryClient,
    slug: "acme",
  });
  jest.advanceTimersByTime(1200);

  expect(add.mock.calls[0]?.[0].title).toBe("ENG-1 changed");
  add.mockRestore();
});

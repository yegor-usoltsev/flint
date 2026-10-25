import type {
  Comment,
  IssueEvent,
  IssueEventKind,
  IssueEventValue,
  UserRef,
} from "~/lib/api-types";

export const activityWindowMs = 10 * 60 * 1000;

type MoveKind = "assignee" | "priority" | "status" | "title";

type FlagKind = "created" | "deleted" | "description" | "restored";

export type ActivityChange =
  | { from: IssueEventValue; kind: MoveKind; to: IssueEventValue }
  | {
      added: string[];
      kind: FlagKind | "labels";
      removed: string[];
    };

export type ActivityItem =
  | { comment: Comment; type: "comment" }
  | {
      actor: UserRef | null;
      changes: ActivityChange[];
      createdAt: string;
      id: string;
      type: "event";
      viaApi: boolean;
    };

interface Move {
  from: IssueEventValue;
  to: IssueEventValue;
}

const hiddenKinds = new Set<IssueEventKind>([
  "comment_created",
  "comment_deleted",
  "comment_edited",
]);

const moveKinds = new Set<IssueEventKind>([
  "assignee",
  "priority",
  "status",
  "title",
]);

const isMoveKind = (kind: IssueEventKind): kind is MoveKind =>
  moveKinds.has(kind);

const pairedKinds: Partial<Record<IssueEventKind, IssueEventKind>> = {
  label_removed: "label_added",
  restored: "deleted",
};

const toggle = (from: Set<string>, into: Set<string>, id: IssueEventValue) => {
  const key = String(id);

  if (!from.delete(key)) {
    into.add(key);
  }
};

const flag = (kind: FlagKind) => ({
  added: [],
  kind,
  removed: [],
});

const netChanges = (events: IssueEvent[]) => {
  const moves = new Map<MoveKind, Move>();
  const added = new Set<string>();
  const removed = new Set<string>();
  const order = new Set<IssueEventKind>();
  let lifecycle = 0;

  for (const event of events) {
    order.add(pairedKinds[event.kind] ?? event.kind);

    if (isMoveKind(event.kind)) {
      const previous = moves.get(event.kind);

      moves.set(event.kind, {
        from: previous === undefined ? event.fromValue : previous.from,
        to: event.toValue,
      });
    } else if (event.kind === "label_added") {
      toggle(removed, added, event.toValue);
    } else if (event.kind === "label_removed") {
      toggle(added, removed, event.fromValue);
    } else if (event.kind === "deleted") {
      lifecycle += 1;
    } else if (event.kind === "restored") {
      lifecycle -= 1;
    }
  }

  return [...order].flatMap((kind): ActivityChange[] => {
    if (isMoveKind(kind)) {
      const move = moves.get(kind);

      return move === undefined || move.from === move.to
        ? []
        : [{ kind, ...move }];
    }

    if (kind === "label_added") {
      return added.size + removed.size === 0
        ? []
        : [{ added: [...added], kind: "labels", removed: [...removed] }];
    }

    if (kind === "description") {
      return [flag(kind)];
    }

    if (kind === "deleted" && lifecycle !== 0) {
      return [flag(lifecycle > 0 ? "deleted" : "restored")];
    }

    return [];
  });
};

const eventItems = (events: IssueEvent[]): ActivityItem[] => {
  const [first] = events;

  if (first === undefined) {
    return [];
  }

  const base = {
    actor: first.actor,
    createdAt: first.createdAt,
    type: "event" as const,
    viaApi: first.viaApi,
  };

  if (first.kind === "created") {
    return [{ ...base, changes: [flag("created")], id: first.id }];
  }

  const changes = netChanges(events);

  const items = [
    {
      changes: changes.filter((change) => change.kind !== "status"),
      id: first.id,
    },
    {
      changes: changes.filter((change) => change.kind === "status"),
      id: `${first.id}:status`,
    },
  ].filter((item) => item.changes.length > 0);

  if (changes[0]?.kind === "status") {
    items.reverse();
  }

  return items.map((item) => ({ ...base, ...item }));
};

const continues = (run: IssueEvent[], event: IssueEvent) => {
  const last = run.at(-1);

  if (last === undefined || last.kind === "created") {
    return false;
  }

  const gap = Date.parse(event.createdAt) - Date.parse(last.createdAt);
  const sameActor = (last.actor?.id ?? null) === (event.actor?.id ?? null);

  return (
    event.kind !== "created" &&
    sameActor &&
    last.viaApi === event.viaApi &&
    gap <= activityWindowMs
  );
};

export const activityFeed = (events: IssueEvent[], comments: Comment[]) => {
  const entries = [
    ...events.flatMap((event) =>
      hiddenKinds.has(event.kind) ? [] : [{ at: event.createdAt, event }]
    ),
    ...comments.map((comment) => ({ at: comment.createdAt, comment })),
  ].toSorted((a, b) => a.at.localeCompare(b.at));

  const items: ActivityItem[] = [];
  let run: IssueEvent[] = [];

  const close = () => {
    items.push(...eventItems(run));
    run = [];
  };

  for (const entry of entries) {
    if ("comment" in entry) {
      close();
      items.push({ comment: entry.comment, type: "comment" });
    } else {
      if (!continues(run, entry.event)) {
        close();
      }

      run.push(entry.event);
    }
  }

  close();

  return items;
};

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ArrowUpIcon,
  EllipsisIcon,
  PencilIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { ConflictDialog } from "~/components/conflict-dialog";
import {
  AttachButton,
  MarkdownEditor,
  SourceToggle,
} from "~/components/markdown-editor";
import type { MarkdownEditorHandle } from "~/components/markdown-editor";
import { Keys } from "~/components/shortcuts-dialog";
import { StatusIcon } from "~/components/status-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { UserAvatar } from "~/components/user-avatar";
import { activityFeed } from "~/lib/activity";
import type { ActivityItem } from "~/lib/activity";
import { ApiError, api, useMe } from "~/lib/api";
import type {
  Comment,
  Issue,
  IssueEvent,
  IssueEventValue,
  ProjectDetail,
  UserRef,
} from "~/lib/api-types";
import { newId } from "~/lib/ids";
import { formatRelative } from "~/lib/issue-view";
import { notifyError } from "~/lib/notify";
import { priorities } from "~/lib/priorities";
import type { Priority } from "~/lib/priorities";
import { labelsQuery, membersQuery, timelineQuery } from "~/lib/queries";
import { useStoredText, useUploading } from "~/lib/use-draft";
import { useCommands } from "~/lib/use-hotkey";
import { useWorkspace } from "~/lib/use-workspace";

interface Timeline {
  comments: Comment[];
  events: IssueEvent[];
}

type EventItem = Extract<ActivityItem, { type: "event" }>;

const cardClass =
  "bg-card shadow-raised -mx-2 flex flex-col gap-1.5 rounded-md border p-4";

const Time = ({ at }: { at: string }) => (
  <time
    className="text-muted-foreground shrink-0"
    dateTime={at}
    title={new Date(at).toLocaleString()}
  >
    {formatRelative(at)}
  </time>
);

const Author = ({
  user,
  viaApi,
}: {
  user: UserRef | null;
  viaApi: boolean;
}) => (
  <>
    <span className="font-medium">{user?.displayName ?? "Someone"}</span>
    {viaApi ? " via API" : null}
  </>
);

const separator = (index: number, count: number) => {
  if (index === 0) {
    return null;
  }

  return index === count - 1 ? " and " : ", ";
};

const joinClauses = (clauses: ReactNode[]) =>
  clauses.flatMap((clause, index) => [
    separator(index, clauses.length),
    <Fragment key={index}>{clause}</Fragment>,
  ]);

const priorityOf = new Map<IssueEventValue, Priority>([
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
]);

const useNames = (project: ProjectDetail) => {
  const workspace = useWorkspace();
  const members = useQuery(membersQuery(workspace.slug)).data ?? [];
  const labels = useQuery(labelsQuery(workspace.slug)).data ?? [];

  const member = (id: IssueEventValue) =>
    members.find((item) => item.userId === id)?.displayName ?? "someone";

  const status = (id: IssueEventValue) =>
    project.statuses.find((item) => item.id === id)?.name ?? "a removed status";

  const label = (id: string) => {
    const found = labels.find((item) => item.id === id);

    return found === undefined ? (
      "a deleted label"
    ) : (
      <span className="inline-flex items-center gap-1" data-color={found.color}>
        <span aria-hidden className="bg-swatch size-1.5 rounded-full" />
        {found.name}
      </span>
    );
  };

  return { label, member, status };
};

const labelClause = (
  verb: string,
  ids: string[],
  name: (id: string) => ReactNode
) =>
  ids.length === 0
    ? []
    : [
        <>
          {verb} {ids.length === 1 ? "label" : "labels"}{" "}
          {joinClauses(ids.map(name))}
        </>,
      ];

const plainChanges = {
  created: "created the issue",
  deleted: "deleted the issue",
  description: "updated the description",
  restored: "restored the issue",
} as const;

const assigneeClause = (
  change: { from: IssueEventValue; to: IssueEventValue },
  actor: UserRef | null,
  names: ReturnType<typeof useNames>
) => {
  if (change.to === null) {
    return `unassigned ${names.member(change.from)}`;
  }

  return change.to === actor?.id
    ? "self-assigned the issue"
    : `assigned the issue to ${names.member(change.to)}`;
};

const clauses = (
  item: EventItem,
  names: ReturnType<typeof useNames>
): ReactNode[] =>
  item.changes.flatMap((change): ReactNode[] => {
    if (change.kind === "labels") {
      return [
        ...labelClause("added", change.added, names.label),
        ...labelClause("removed", change.removed, names.label),
      ];
    }

    if (change.kind === "assignee") {
      return [assigneeClause(change, item.actor, names)];
    }

    if (change.kind === "priority") {
      const priority = priorityOf.get(change.to) ?? 0;

      return [
        priority === 0
          ? "removed priority"
          : `set priority to ${priorities[priority]}`,
      ];
    }

    if (change.kind === "status") {
      return [
        `moved from ${names.status(change.from)} to ${names.status(change.to)}`,
      ];
    }

    if (change.kind === "title") {
      return [`changed title to ${String(change.to)}`];
    }

    return [plainChanges[change.kind]];
  });

const EventIcon = ({
  item,
  project,
}: {
  item: EventItem;
  project: ProjectDetail;
}) => {
  const [change] = item.changes;

  if (change?.kind === "status") {
    const status = project.statuses.find((entry) => entry.id === change.to);

    if (status !== undefined) {
      return <StatusIcon category={status.category} color={status.color} />;
    }
  }

  if (item.changes.every((entry) => entry.kind === "labels")) {
    return <TagIcon aria-hidden className="text-muted-foreground size-3.5" />;
  }

  return (
    <UserAvatar
      avatarUrl={item.actor?.avatarUrl ?? ""}
      className="size-3.5"
      name={item.actor?.displayName ?? "?"}
    />
  );
};

const EventRow = ({
  item,
  project,
}: {
  item: EventItem;
  project: ProjectDetail;
}) => {
  const names = useNames(project);

  return (
    <li className="relative flex items-start gap-3 py-1.5 pl-2.5 text-xs">
      <span className="bg-background relative flex h-4 w-3.5 shrink-0 items-center justify-center">
        <EventIcon item={item} project={project} />
      </span>
      <span className="text-muted-foreground min-w-0 leading-4">
        <Author user={item.actor} viaApi={item.viaApi} />{" "}
        {joinClauses(clauses(item, names))}
        <span aria-hidden> · </span>
        <Time at={item.createdAt} />
      </span>
    </li>
  );
};

const useTimelineCache = (issue: Issue) => {
  const queryClient = useQueryClient();
  const { queryKey } = timelineQuery(issue);

  const update = (change: (comments: Comment[]) => Comment[]) => {
    queryClient.setQueryData<Timeline>(queryKey, (current) =>
      current === undefined
        ? current
        : { ...current, comments: change(current.comments) }
    );
  };

  return { queryClient, queryKey, update };
};

const CommentVersionSchema = v.looseObject({
  body: v.string(),
  version: v.number(),
});

const CommentItem = ({
  comment,
  issue,
  own,
}: {
  comment: Comment;
  issue: Issue;
  own: boolean;
}) => {
  const cache = useTimelineCache(issue);

  const [editing, setEditing, readEditing] = useStoredText(
    `comment:${comment.id}`
  );

  const [base, setBase] = useStoredText(`comment-base:${comment.id}`);
  const [deleting, setDeleting] = useState(false);
  const [conflict, setConflict] = useState<Comment | null>(null);
  const uploading = useUploading(`comment:${comment.id}`);

  const startEditing = (body: string, version: number) => {
    setEditing(body);
    setBase(String(version));
  };

  const stopEditing = () => {
    setEditing(null);
    setBase(null);
  };

  const save = useMutation({
    mutationFn: async ({ body, version }: { body: string; version: number }) =>
      await api<Comment>(`/comments/${comment.id}`, {
        body: { body, version },
        method: "PATCH",
      }),
    onMutate: ({ body, version }) => {
      cache.update((comments) =>
        comments.map((item) =>
          item.id === comment.id ? { ...item, body } : item
        )
      );
      stopEditing();

      return { body: comment.body, draft: body, version };
    },
    onError: (error, _change, context) => {
      cache.update((comments) =>
        comments.map((item) =>
          item.id === comment.id ? { ...item, body: context?.body ?? "" } : item
        )
      );

      if (readEditing() === null && context !== undefined) {
        startEditing(context.draft, context.version);
      }

      const current = error instanceof ApiError ? error.current : undefined;

      if (
        error instanceof ApiError &&
        error.code === "conflict" &&
        v.is(CommentVersionSchema, current)
      ) {
        cache.update((comments) =>
          comments.map((item) =>
            item.id === comment.id
              ? { ...item, body: current.body, version: current.version }
              : item
          )
        );
        setConflict({ ...comment, ...current });

        return;
      }

      notifyError("Could not save the comment")(error);
    },
    onSettled: async () => {
      await cache.queryClient.invalidateQueries({ queryKey: cache.queryKey });
    },
    onSuccess: (saved) => {
      cache.update((comments) =>
        comments.map((item) => (item.id === saved.id ? saved : item))
      );
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api(`/comments/${comment.id}`, { method: "DELETE" });
    },
    onError: notifyError("Could not delete the comment"),
    onSettled: async () => {
      await cache.queryClient.invalidateQueries({ queryKey: cache.queryKey });
    },
  });

  const submit = () => {
    if (editing !== null && editing.trim() !== "" && !uploading) {
      save.mutate({
        body: editing,
        version: base === null ? comment.version : Number(base),
      });
    }
  };

  return (
    <li className={cardClass}>
      <header className="flex min-h-6 items-center gap-2">
        <UserAvatar
          avatarUrl={comment.author.avatarUrl}
          className="size-4.5"
          name={comment.author.displayName}
        />
        <span className="min-w-0 truncate">
          <Author user={comment.author} viaApi={comment.viaApi} />
        </span>
        <Time at={comment.createdAt} />
        {comment.editedAt === null ? null : (
          <span className="text-muted-foreground">(edited)</span>
        )}
        {own && editing === null ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label="Comment options"
                  className="ml-auto"
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={save.isPending}
                onClick={() => {
                  startEditing(comment.body, comment.version);
                }}
              >
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDeleting(true);
                }}
                variant="destructive"
              >
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      {editing === null ? (
        <MarkdownEditor
          attachments={`/issues/${issue.key}/attachments`}
          checkable={own}
          className="text-prose"
          editable={false}
          label={`Comment by ${comment.author.displayName}`}
          onChange={(body) => {
            save.mutate({ body, version: comment.version });
          }}
          value={comment.body}
        />
      ) : (
        <>
          <MarkdownEditor
            autoFocus
            className="text-prose"
            label="Edit comment"
            onCancel={stopEditing}
            onChange={setEditing}
            draft={{
              key: `comment:${comment.id}`,
              read: () => readEditing() ?? comment.body,
            }}
            onSubmit={submit}
            uploadTo={`/issues/${issue.key}/attachments`}
            value={editing}
          />
          <div className="flex justify-end gap-1.5">
            <Button onClick={stopEditing} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={editing.trim() === "" || uploading}
              onClick={submit}
              size="sm"
            >
              {uploading ? "Uploading…" : "Save"}
            </Button>
          </div>
        </>
      )}
      <ConflictDialog
        field="comment"
        mine={editing ?? ""}
        onKeepMine={() => {
          if (conflict !== null && editing !== null) {
            setConflict(null);
            save.mutate({ body: editing, version: conflict.version });
          }
        }}
        onUseTheirs={() => {
          setConflict(null);
          stopEditing();
        }}
        saved={conflict?.body ?? null}
      />
      <AlertDialog onOpenChange={setDeleting} open={deleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              The comment disappears from the issue for everyone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                remove.mutate();
              }}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
};

const CommentBox = ({ issue }: { issue: Issue }) => {
  const me = useMe().data;
  const cache = useTimelineCache(issue);
  const [stored, setBody, readBody] = useStoredText(`new-comment:${issue.id}`);
  const body = stored ?? "";
  const [source, setSource] = useState(false);
  const uploading = useUploading(`new-comment:${issue.id}`);
  const editor = useRef<MarkdownEditorHandle>(null);

  useCommands([
    {
      group: "Issue",
      hotkey: { keys: "m" },
      id: "comment",
      label: "Comment…",
      run: () => {
        editor.current?.focus();
      },
    },
  ]);

  const create = useMutation({
    mutationFn: async (comment: Comment) =>
      await api<Comment>(`/issues/${issue.key}/comments`, {
        body: { body: comment.body, id: comment.id },
        method: "POST",
      }),
    onMutate: (comment) => {
      cache.update((comments) => [...comments, comment]);
      setBody(null);
    },
    onError: (error, comment) => {
      cache.update((comments) =>
        comments.filter((item) => item.id !== comment.id)
      );

      if ((readBody() ?? "") === "") {
        setBody(comment.body);
      }

      notifyError("Could not post the comment")(error);
    },
    onSettled: async () => {
      await cache.queryClient.invalidateQueries({ queryKey: cache.queryKey });
    },
    onSuccess: (saved) => {
      cache.update((comments) =>
        comments.map((item) => (item.id === saved.id ? saved : item))
      );
    },
  });

  const submit = () => {
    if (body.trim() === "" || uploading || me === undefined || me === null) {
      return;
    }

    create.mutate({
      author: {
        avatarUrl: me.avatarUrl,
        displayName: me.displayName,
        id: me.id,
        username: me.username,
      },
      body,
      createdAt: new Date().toISOString(),
      editedAt: null,
      version: 1,
      id: newId(),
      issueId: issue.id,
      viaApi: false,
    });
  };

  return (
    <div className={cn(cardClass, "gap-2 pb-3")}>
      <MarkdownEditor
        className="text-prose min-h-12"
        label="Comment"
        onChange={setBody}
        draft={{
          key: `new-comment:${issue.id}`,
          read: () => readBody() ?? "",
        }}
        onSubmit={submit}
        placeholder="Leave a comment…"
        ref={editor}
        source={source}
        uploadTo={`/issues/${issue.key}/attachments`}
        value={body}
      />
      <div className="flex items-center justify-end gap-1">
        <SourceToggle onChange={setSource} source={source} />
        <AttachButton
          onFiles={(files) => {
            editor.current?.upload(files);
          }}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-keyshortcuts="Meta+Enter"
                aria-label={uploading ? "Uploading…" : "Comment"}
                disabled={body.trim() === "" || uploading}
                onClick={submit}
                size="icon-round"
                variant={body.trim() === "" ? "secondary" : "default"}
              />
            }
          >
            <ArrowUpIcon />
          </TooltipTrigger>
          <TooltipContent>
            Comment
            <Keys hotkey={{ keys: "enter", mod: true }} />
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

const runs = (items: ActivityItem[]) => {
  const result: (Comment | EventItem[])[] = [];

  for (const item of items) {
    const last = result.at(-1);

    if (item.type === "comment") {
      result.push(item.comment);
    } else if (Array.isArray(last)) {
      last.push(item);
    } else {
      result.push([item]);
    }
  }

  return result;
};

export const IssueTimeline = ({
  editable,
  issue,
  project,
}: {
  editable: boolean;
  issue: Issue;
  project: ProjectDetail;
}) => {
  const me = useMe().data;
  const timeline = useQuery(timelineQuery(issue));

  const feed = runs(
    activityFeed(timeline.data?.events ?? [], timeline.data?.comments ?? [])
  );

  return (
    <section
      aria-labelledby="activity-heading"
      className="flex flex-col gap-4 border-t pt-5"
    >
      <h2
        className="text-prose leading-5.75 font-semibold"
        id="activity-heading"
      >
        Activity
      </h2>
      {timeline.isPending ? (
        <div aria-busy className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {feed.map((entry) =>
            Array.isArray(entry) ? (
              <li key={entry[0]?.id}>
                <ol className="before:bg-border relative before:absolute before:inset-y-3 before:left-4.25 before:w-px">
                  {entry.map((item) => (
                    <EventRow item={item} key={item.id} project={project} />
                  ))}
                </ol>
              </li>
            ) : (
              <CommentItem
                comment={entry}
                issue={issue}
                key={entry.id}
                own={entry.author.id === me?.id}
              />
            )
          )}
        </ol>
      )}
      {editable && !timeline.isPending ? <CommentBox issue={issue} /> : null}
    </section>
  );
};

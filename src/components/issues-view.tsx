import { CollisionPriority } from "@dnd-kit/abstract";
import type { CollisionDetector } from "@dnd-kit/abstract";
import { defaultCollisionDetection } from "@dnd-kit/collision";
import {
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import type { Customizable, Sensors } from "@dnd-kit/dom";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider, DragOverlay, useDroppable } from "@dnd-kit/react";
import type { DragDropEventHandlers } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ChevronRightIcon,
  KanbanIcon,
  ListIcon,
  ListFilterIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { useCreateIssue } from "~/components/create-issue";
import { FilterChips, FilterMenu } from "~/components/issue-filters";
import { IssueContextMenu } from "~/components/issue-menu";
import {
  Assignee,
  CheckBox,
  Checklist,
  IssueLabels,
  CiIcon,
  PullRequestIcon,
} from "~/components/issue-parts";
import type { IssueLookup } from "~/components/issue-parts";
import { LoadFailed, RefreshFailed } from "~/components/load-failed";
import { PriorityIcon } from "~/components/priority-icon";
import { ProjectPage } from "~/components/project-page";
import { StatusIcon } from "~/components/status-icon";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { IssueSummary, ProjectDetail, Status } from "~/lib/api-types";
import { closeIssueMenu, selectByClick, toggleRow } from "~/lib/issue-focus";
import {
  useSelected,
  useSelecting,
  useSelectionScope,
} from "~/lib/issue-selection";
import {
  filterIssues,
  formatDate,
  groupIssues,
  isClosedStatus,
  isFiltered,
  rememberView,
  shownStatuses,
  useProjectView,
  sortKeyBetween,
  withKnownLabels,
} from "~/lib/issue-view";
import type { IssueSearch, Order, ViewKind } from "~/lib/issue-view";
import {
  closedIssuesQuery,
  issueCountsQuery,
  issueQuery,
  issuesQuery,
  labelsQuery,
  membersQuery,
} from "~/lib/queries";
import { useCommands } from "~/lib/use-hotkey";
import { useUpdateIssue } from "~/lib/use-update-issue";
import type { IssuePatch } from "~/lib/use-update-issue";
import { useWorkspace } from "~/lib/use-workspace";

type Columns = Record<string, string[]>;

const sensors: Customizable<Sensors> = (defaults) => [
  ...defaults.filter(
    (sensor) => sensor !== PointerSensor && sensor !== KeyboardSensor
  ),
  KeyboardSensor.configure({
    keyboardCodes: {
      cancel: ["Escape"],
      down: ["ArrowDown"],
      end: ["Space", "Enter", "Tab"],
      left: ["ArrowLeft"],
      right: ["ArrowRight"],
      start: ["Space"],
      up: ["ArrowUp"],
    },
  }),
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ tolerance: 5, value: 200 })]
        : [new PointerActivationConstraints.Distance({ value: 4 })],
  }),
];

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";
const sortableTransition = { duration: 150, easing: easeOut, idle: false };
const dropAnimation = { duration: 150, easing: easeOut };

interface ViewProps {
  columns: Columns;
  dragging: string | null;
  footer: (status: Status) => ReactNode;
  issues: Map<string, IssueSummary>;
  lookup: IssueLookup;
  onOpen: OpenIssue;
  statuses: Status[];
  total: (status: Status, loaded: number) => number;
}

type OpenIssue = (
  issue: IssueSummary,
  how: "open" | "prefetch" | "tab"
) => void;

const behindItems: CollisionDetector = (input) => {
  const collision = defaultCollisionDetection(input);

  return collision && { ...collision, priority: CollisionPriority.Low };
};

const useColumn = (status: Status, collapsed = false) =>
  useDroppable({
    accept: "item",
    collisionDetector: collapsed ? defaultCollisionDetection : behindItems,
    id: status.id,
    type: "column",
  });

const Sortable = ({
  children,
  className,
  group,
  index,
  issue,
  onOpen,
}: {
  children: ReactNode;
  className: string;
  group: string;
  index: number;
  issue: IssueSummary;
  onOpen: OpenIssue;
}) => {
  const { id } = issue;

  const { isDragSource, ref } = useSortable({
    accept: "item",
    group,
    id,
    index,
    transition: sortableTransition,
    type: "item",
  });

  const selected = useSelected(id);

  return (
    <button
      className={cn(className, isDragSource && "opacity-40")}
      data-issue={id}
      data-selected={selected ? "true" : undefined}
      onAuxClick={(event) => {
        if (event.button === 1) {
          onOpen(issue, "tab");
        }
      }}
      onClick={(event) => {
        if (!selectByClick(event, id)) {
          onOpen(issue, "open");
        }
      }}
      onFocus={() => {
        onOpen(issue, "prefetch");
      }}
      onPointerEnter={() => {
        onOpen(issue, "prefetch");
      }}
      ref={ref}
      type="button"
    >
      {selected ? <span className="sr-only">Selected,</span> : null}
      {children}
    </button>
  );
};

export const rowClass =
  "group/row relative flex min-h-11 w-full cursor-default flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md px-2 py-2 text-left outline-none select-none hover:bg-row-focus focus-visible:bg-row-focus focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset data-selected:bg-row-selected data-selected:hover:bg-row-selected-hover data-selected:focus-visible:bg-row-selected-hover data-menu-target:bg-row-focus data-selected:data-menu-target:bg-row-selected-hover md:h-11 md:min-h-0 md:flex-nowrap md:py-0";

export const RowCheck = ({ id }: { id: string }) => {
  const selected = useSelected(id);
  const selecting = useSelecting();

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- A pointer shortcut; X selects the focused row from the keyboard. */}
      <span
        className={cn(
          "hit-area relative -mr-0.5 flex size-4 shrink-0 items-center justify-center opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 group-data-menu-target/row:opacity-100 max-md:hidden",
          selected && "opacity-100",
          selecting && "max-md:flex max-md:opacity-100"
        )}
        onClick={(event) => {
          toggleRow(event, id);
        }}
      >
        <CheckBox checked={selected} />
      </span>
    </>
  );
};

export const listClass = "px-2 pb-16";

const IssueStatus = ({
  issue,
  lookup,
}: {
  issue: IssueSummary;
  lookup: IssueLookup;
}) => {
  const status = lookup.statuses.get(issue.statusId);

  if (status === undefined) {
    return null;
  }

  return <StatusIcon category={status.category} color={status.color} />;
};

export const RowContent = ({
  issue,
  lookup,
}: {
  issue: IssueSummary;
  lookup: IssueLookup;
}) => (
  <>
    <RowCheck id={issue.id} />
    <PriorityIcon priority={issue.priority} />
    <span className="text-muted-foreground tracking-key shrink-0 whitespace-nowrap tabular-nums max-md:text-xs md:min-w-16">
      {issue.key}
    </span>
    <IssueStatus issue={issue} lookup={lookup} />
    <span className="order-first w-[calc(100%-1.875rem)] font-medium break-words max-md:line-clamp-2 md:order-none md:w-auto md:min-w-0 md:flex-1 md:truncate min-[120rem]:max-w-240">
      {issue.title}
    </span>
    <span className="flex max-w-[40%] min-w-0 shrink items-center gap-1 overflow-hidden max-[120rem]:empty:hidden md:hidden lg:flex min-[120rem]:w-96 min-[120rem]:max-w-none min-[120rem]:shrink-0 max-md:[&>:nth-child(n+2)]:hidden">
      <IssueLabels issue={issue} lookup={lookup} />
    </span>
    {issue.labelIds.length > 1 ? (
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums md:hidden">
        +{issue.labelIds.length - 1}
      </span>
    ) : null}
    <span className="contents min-[120rem]:flex min-[120rem]:w-20 min-[120rem]:items-center min-[120rem]:justify-end min-[120rem]:gap-2.5">
      <PullRequestIcon state={issue.pullRequestState} />
      <CiIcon state={issue.ciState} />
      <Checklist issue={issue} />
    </span>
    <Assignee
      className="order-first self-start md:order-none md:self-auto"
      issue={issue}
      lookup={lookup}
    />
    <time
      className="text-muted-foreground ml-auto w-14 shrink-0 text-right text-xs tabular-nums md:ml-0"
      dateTime={issue.updatedAt}
    >
      <span className="sr-only">Updated </span>
      {formatDate(issue.updatedAt)}
    </time>
  </>
);

const ListGroup = ({
  dragging,
  footer,
  ids,
  issues,
  lookup,
  onOpen,
  status,
  total,
}: Omit<ViewProps, "columns" | "statuses"> & {
  ids: string[];
  status: Status;
}) => {
  const [open, setOpen] = useState(true);
  const { isDropTarget, ref } = useColumn(status, !open);
  const shown = open ? ids : ids.filter((id) => id === dragging);

  return (
    <section aria-labelledby={`group-${status.id}`} ref={ref}>
      <h2 className="sticky top-0 z-10" id={`group-${status.id}`}>
        <button
          aria-expanded={open}
          className={cn(
            "bg-group-header hover:bg-group-header-hover focus-visible:bg-group-header-hover hit-area relative flex h-9 w-full items-center gap-2 rounded-md px-2 text-left font-medium outline-none",
            isDropTarget && "bg-row-selected"
          )}
          onClick={() => {
            setOpen(!open);
          }}
          type="button"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "text-muted-foreground size-3.5 transition-transform duration-150",
              open && "rotate-90"
            )}
          />
          <StatusIcon category={status.category} color={status.color} />
          {status.name}
          <span className="text-muted-foreground font-normal tabular-nums">
            {total(status, ids.length)}
          </span>
        </button>
      </h2>
      {shown.map((id, index) => {
        const issue = issues.get(id);

        return issue === undefined ? null : (
          <Sortable
            className={rowClass}
            group={status.id}
            index={index}
            issue={issue}
            key={id}
            onOpen={onOpen}
          >
            <RowContent issue={issue} lookup={lookup} />
          </Sortable>
        );
      })}
      {open ? footer(status) : null}
    </section>
  );
};

const List = ({ columns, statuses, ...props }: ViewProps) => (
  <div className={listClass}>
    {statuses.map((status) => (
      <ListGroup
        ids={columns[status.id] ?? []}
        key={status.id}
        status={status}
        {...props}
      />
    ))}
  </div>
);

const cardClass =
  "relative flex w-full cursor-default flex-col gap-2 rounded-md bg-card p-3 text-left shadow-card outline-none select-none hover:bg-surface-1 focus-visible:ring-1 focus-visible:ring-ring data-selected:bg-row-selected dark:bg-surface-2 dark:hover:bg-surface-3 dark:data-selected:bg-row-selected data-selected:hover:bg-row-selected-hover dark:data-selected:hover:bg-row-selected-hover data-menu-target:bg-surface-1 dark:data-menu-target:bg-surface-3 data-selected:data-menu-target:bg-row-selected-hover dark:data-selected:data-menu-target:bg-row-selected-hover";

const CardContent = ({
  issue,
  lookup,
}: {
  issue: IssueSummary;
  lookup: IssueLookup;
}) => (
  <>
    <span className="flex flex-col gap-0.5">
      <span className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
        {issue.key}
        <Assignee className="ml-auto" issue={issue} lookup={lookup} />
      </span>
      <span className="flex items-start gap-2">
        <span className="flex h-5 shrink-0 items-center">
          <IssueStatus issue={issue} lookup={lookup} />
        </span>
        <span className="line-clamp-2 font-medium break-words">
          {issue.title}
        </span>
      </span>
    </span>
    <span className="flex flex-wrap items-center gap-1.5 empty:hidden">
      {issue.priority === 0 ? null : (
        <span className="border-hairline flex size-6 items-center justify-center rounded-md">
          <PriorityIcon priority={issue.priority} />
        </span>
      )}
      <IssueLabels issue={issue} lookup={lookup} max={2} />
      <PullRequestIcon state={issue.pullRequestState} />
      <CiIcon state={issue.ciState} />
      <Checklist issue={issue} />
    </span>
    <time
      className="text-muted-foreground text-xs tabular-nums"
      dateTime={issue.updatedAt}
    >
      Updated {formatDate(issue.updatedAt)}
    </time>
  </>
);

const BoardColumn = ({
  footer,
  ids,
  issues,
  lookup,
  onOpen,
  status,
  total,
}: Omit<ViewProps, "columns" | "dragging" | "statuses"> & {
  ids: string[];
  status: Status;
}) => {
  const { isDropTarget, ref } = useColumn(status);
  const createIssue = useCreateIssue();

  return (
    <section
      aria-labelledby={`column-${status.id}`}
      className={cn(
        "bg-surface-1 flex w-[340px] max-w-[85vw] shrink-0 snap-start flex-col rounded-md transition-colors duration-150 md:max-w-none",
        isDropTarget && "bg-row-selected"
      )}
      ref={ref}
    >
      <header className="flex h-[50px] shrink-0 items-center gap-2 px-3">
        <StatusIcon category={status.category} color={status.color} />
        <h2 className="truncate font-medium" id={`column-${status.id}`}>
          {status.name}
        </h2>
        <span className="text-muted-foreground tabular-nums">
          {total(status, ids.length)}
        </span>
        <Button
          aria-label={`New issue in ${status.name}`}
          className="ml-auto"
          onClick={() => {
            createIssue({ statusId: status.id });
          }}
          size="icon-xs"
          variant="ghost"
        >
          <PlusIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.25 pb-2">
        {ids.map((id, index) => {
          const issue = issues.get(id);

          return issue === undefined ? null : (
            <Sortable
              className={cardClass}
              group={status.id}
              index={index}
              issue={issue}
              key={id}
              onOpen={onOpen}
            >
              <CardContent issue={issue} lookup={lookup} />
            </Sortable>
          );
        })}
        {footer(status)}
      </div>
    </section>
  );
};

const Board = ({ columns, statuses, ...props }: ViewProps) => (
  <div
    className="flex min-h-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto p-2 md:snap-none"
    data-board
  >
    {statuses.map((status) => (
      <BoardColumn
        ids={columns[status.id] ?? []}
        key={status.id}
        status={status}
        {...props}
      />
    ))}
  </div>
);

const mergeIssues = (
  working: IssueSummary[] | undefined,
  closed: IssueSummary[][] | undefined
) => {
  const open = working ?? [];
  const ids = new Set(open.map((issue) => issue.id));

  return [
    ...open,
    ...(closed ?? []).flat().filter((issue) => !ids.has(issue.id)),
  ];
};

const NewIssueButton = () => {
  const createIssue = useCreateIssue();

  return (
    <Button
      onClick={() => {
        createIssue();
      }}
    >
      <PlusIcon data-icon="inline-start" />
      New issue
    </Button>
  );
};

const FirstIssue = ({ statusId }: { statusId: string }) => {
  const createIssue = useCreateIssue();

  return (
    <div className="text-muted-foreground flex flex-col items-start gap-2 rounded-lg border border-dashed p-3">
      <p>No issues yet. Create the first one here, or press C.</p>
      <Button
        onClick={() => {
          createIssue({ statusId });
        }}
        size="sm"
        variant="outline"
      >
        <PlusIcon data-icon="inline-start" />
        Create issue
      </Button>
    </div>
  );
};

const placement = (columns: Columns, id: string) => {
  const entry = Object.entries(columns).find(([, ids]) => ids.includes(id));

  return (
    entry && { ids: entry[1], index: entry[1].indexOf(id), statusId: entry[0] }
  );
};

const useClosedIssues = (project: ProjectDetail, search: IssueSearch) => {
  const enabled = search.closed === true;

  const closed = useInfiniteQuery({
    ...closedIssuesQuery(project, search),
    enabled,
  });

  const counts = useQuery({ ...issueCountsQuery(project, search), enabled });

  const totals = new Map(
    counts.data?.map((count) => [count.statusId, count.count])
  );

  const total = (status: Status, loaded: number) =>
    enabled && isClosedStatus(status)
      ? Math.max(loaded, totals.get(status.id) ?? 0)
      : loaded;

  const hasOlder = (status: Status, loaded: number) => {
    if (!enabled || !isClosedStatus(status) || !closed.hasNextPage) {
      return false;
    }

    return counts.data === undefined || loaded < total(status, loaded);
  };

  return { closed, hasOlder, total };
};

const Issues = ({
  onClearFilters,
  project,
  search,
  view,
}: {
  onClearFilters: () => void;
  project: ProjectDetail;
  search: IssueSearch;
  view: ViewKind;
}) => {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const issues = useQuery(issuesQuery(project));

  const { closed, hasOlder, total } = useClosedIssues(project, search);

  const members = useQuery(membersQuery(workspace.slug));
  const labels = useQuery(labelsQuery(workspace.slug));
  const updateIssue = useUpdateIssue();

  const [drag, setDrag] = useState<{ columns: Columns; id: string } | null>(
    null
  );

  const order: Order = search.order ?? "manual";

  const all = mergeIssues(
    issues.data,
    search.closed === true ? closed.data?.pages : undefined
  );

  const visible = filterIssues(all, search);

  useSelectionScope(visible.map((issue) => issue.id));

  if (issues.data === undefined) {
    return issues.isError ? (
      <LoadFailed
        className="m-4"
        error={issues.error}
        onRetry={() => {
          void issues.refetch();
        }}
        title="Issues could not load"
      />
    ) : (
      <div aria-busy className="flex flex-col gap-2 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    );
  }

  const filtered = isFiltered(search);

  if (visible.length === 0 && (view === "list" || filtered)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {filtered ? <ListFilterIcon /> : <ListIcon />}
          </EmptyMedia>
          <EmptyTitle>
            <h2>
              {filtered ? "No issues match these filters" : "No issues yet"}
            </h2>
          </EmptyTitle>
          <EmptyDescription>
            {filtered
              ? "Change or clear the filters to see more issues."
              : `Issues in ${project.name} appear here, grouped by status.`}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {filtered ? (
            <Button onClick={onClearFilters} size="sm" variant="outline">
              Clear filters
            </Button>
          ) : (
            <NewIssueButton />
          )}
        </EmptyContent>
      </Empty>
    );
  }

  const groups = groupIssues(visible, project.statuses, order);

  const sorted = Object.fromEntries(
    [...groups].map(([statusId, list]) => [
      statusId,
      list.map((issue) => issue.id),
    ])
  );

  const columns = drag?.columns ?? sorted;
  const byId = new Map(all.map((issue) => [issue.id, issue]));

  const lookup: IssueLookup = {
    labels: new Map(labels.data?.map((label) => [label.id, label])),
    statuses: new Map(project.statuses.map((status) => [status.id, status])),
    members: new Map(
      members.data?.flatMap((member) =>
        member.userId === null ? [] : [[member.userId, member]]
      )
    ),
  };

  const manualIn = (statusId: string) => {
    const status = lookup.statuses.get(statusId);

    return (
      order === "manual" && status !== undefined && !isClosedStatus(status)
    );
  };

  const onDragOver: DragDropEventHandlers["onDragOver"] = (event) => {
    const { source, target } = event.operation;

    if (
      isSortable(source) &&
      isSortable(target) &&
      source.group === target.group &&
      !manualIn(String(target.group))
    ) {
      event.preventDefault();

      return;
    }

    setDrag((current) =>
      current === null
        ? null
        : { ...current, columns: move(current.columns, event) }
    );
  };

  const onDragEnd: DragDropEventHandlers["onDragEnd"] = (event) => {
    const id = String(event.operation.source?.id);
    const issue = byId.get(id);
    const to = drag === null ? undefined : placement(drag.columns, id);

    setDrag(null);

    if (event.canceled || issue === undefined || to === undefined) {
      return;
    }

    const from = placement(sorted, id);
    const sameStatus = to.statusId === issue.statusId;
    const manual = manualIn(to.statusId);

    if (sameStatus && (!manual || from?.index === to.index)) {
      return;
    }

    const patch: IssuePatch = { statusId: to.statusId };

    if (manual) {
      patch.sortKey = sortKeyBetween(
        byId.get(to.ids[to.index - 1] ?? "")?.sortKey,
        byId.get(to.ids[to.index + 1] ?? "")?.sortKey
      );
    }

    updateIssue(issue, patch);
  };

  const statuses = shownStatuses(project.statuses, search);

  const footer = (status: Status) => (
    <>
      {visible.length === 0 && status.id === statuses[0]?.id ? (
        <FirstIssue statusId={status.id} />
      ) : null}
      {hasOlder(status, columns[status.id]?.length ?? 0) ? (
        <Button
          className="m-1.5 self-start"
          disabled={closed.isFetchingNextPage}
          onClick={() => {
            void closed.fetchNextPage();
          }}
          size="sm"
          variant="ghost"
        >
          {closed.isFetchingNextPage ? "Loading…" : "Load older issues"}
        </Button>
      ) : null}
    </>
  );

  const onOpen: OpenIssue = (issue, how) => {
    if (issue.version === 0) {
      return;
    }

    if (how === "prefetch") {
      queryClient.query(issueQuery(project.id, issue.key)).catch(() => null);
    } else if (how === "tab") {
      window.open(`/${workspace.slug}/issue/${issue.key}`, "_blank");
    } else {
      void navigate({
        params: { issueKey: issue.key, slug: workspace.slug },
        state: { from: { projectKey: project.key, search, view } },
        to: "/$slug/issue/$issueKey",
      });
    }
  };

  const props: ViewProps = {
    columns,
    dragging: drag?.id ?? null,
    footer,
    issues: byId,
    lookup,
    onOpen,
    statuses,
    total,
  };

  return (
    <>
      <RefreshFailed
        failed={issues.isError}
        onRetry={() => {
          void issues.refetch();
        }}
        what="issues"
      />
      <DragDropProvider
        onDragEnd={onDragEnd}
        onDragMove={closeIssueMenu}
        onDragOver={onDragOver}
        onDragStart={(event) => {
          setDrag({ columns: sorted, id: String(event.operation.source?.id) });
        }}
        sensors={sensors}
      >
        <IssueContextMenu>
          {view === "board" ? <Board {...props} /> : <List {...props} />}
        </IssueContextMenu>
        <DragOverlay dropAnimation={dropAnimation}>
          {(source) => {
            const issue = byId.get(String(source.id));

            return issue === undefined ? null : (
              <div
                className={cn(
                  view === "board" ? cardClass : rowClass,
                  "bg-popover ring-ring/20 cursor-grabbing shadow-lg ring-1"
                )}
              >
                {view === "board" ? (
                  <CardContent issue={issue} lookup={lookup} />
                ) : (
                  <RowContent issue={issue} lookup={lookup} />
                )}
              </div>
            );
          }}
        </DragOverlay>
      </DragDropProvider>
    </>
  );
};

const orders = [
  { label: "Manual", value: "manual" },
  { label: "Priority", value: "priority" },
  { label: "Last updated", value: "updated" },
] as const;

const completedOptions = [
  { label: "Past 2 weeks", value: "recent" },
  { label: "All", value: "all" },
] as const;

const isOrder = (value: unknown): value is Order =>
  orders.some((order) => order.value === value);

const OptionSelect = <Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: readonly { label: string; value: Value }[];
  value: Value;
}) => (
  <div className="flex h-8 items-center justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <Select
      items={options}
      onValueChange={(next) => {
        const option = options.find((item) => item.value === next);

        if (option !== undefined) {
          onChange(option.value);
        }
      }}
      value={value}
    >
      <SelectTrigger aria-label={label} className="w-34" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

const layouts = [
  { icon: ListIcon, label: "List", value: "list" },
  { icon: KanbanIcon, label: "Board", value: "board" },
] as const;

const DisplayOptions = ({
  onChange,
  projectKey,
  search,
  view,
}: {
  onChange: (patch: IssueSearch) => void;
  projectKey: string;
  search: IssueSearch;
  view: ViewKind;
}) => (
  <Popover>
    <Tooltip>
      <TooltipTrigger
        render={
          <PopoverTrigger
            render={
              <Button
                aria-label="Display options"
                size="icon-round"
                variant="ghost"
              />
            }
          />
        }
      >
        <SlidersHorizontalIcon />
      </TooltipTrigger>
      <TooltipContent side="bottom">Display options</TooltipContent>
    </Tooltip>
    <PopoverContent align="end" aria-label="Display options" className="w-76">
      <div className="grid grid-cols-2 gap-2">
        {layouts.map((layout) => (
          <button
            aria-keyshortcuts="Meta+B"
            aria-pressed={layout.value === view}
            className="text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:border-input aria-pressed:text-foreground focus-visible:ring-ring hit-area relative flex h-8 items-center justify-center gap-1.5 rounded-lg border font-medium outline-none focus-visible:ring-2"
            key={layout.value}
            onClick={() => {
              rememberView(projectKey, layout.value);
            }}
            type="button"
          >
            <layout.icon aria-hidden className="size-3.5" />
            {layout.label}
          </button>
        ))}
      </div>
      <OptionSelect
        label="Ordering"
        onChange={(order) => {
          if (isOrder(order)) {
            onChange({ order: order === "manual" ? undefined : order });
          }
        }}
        options={orders}
        value={search.order ?? "manual"}
      />
      <OptionSelect
        label="Completed issues"
        onChange={(completed) => {
          onChange({ closed: completed === "all" ? true : undefined });
        }}
        options={completedOptions}
        value={search.closed === true ? "all" : "recent"}
      />
    </PopoverContent>
  </Popover>
);

export const IssuesView = ({
  projectKey,
  search: requested,
}: {
  projectKey: string;
  search: IssueSearch;
}) => {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const labels = useQuery(labelsQuery(workspace.slug)).data;
  const search = withKnownLabels(requested, labels);
  const view = useProjectView(projectKey);
  const [filtering, setFiltering] = useState(false);
  const createIssue = useCreateIssue();

  const setSearch = (patch: IssueSearch) => {
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, ...patch }),
      to: ".",
    });
  };

  const clearFilters = () => {
    void navigate({
      replace: true,
      search: ({
        assignee: _a,
        label: _l,
        priority: _p,
        status: _s,
        ...rest
      }) => rest,
      to: ".",
    });
  };

  useCommands([
    {
      group: "View",
      hotkey: { keys: "f" },
      id: "filter",
      label: "Filter…",
      run: () => {
        setFiltering(true);
      },
    },
    {
      group: "View",
      hotkey: { keys: "b", mod: true },
      id: "toggle-view",
      label: view === "list" ? "Switch to board" : "Switch to list",
      run: () => {
        rememberView(projectKey, view === "list" ? "board" : "list");
      },
    },
  ]);

  return (
    <ProjectPage
      renderActions={(project) => (
        <>
          <FilterMenu
            onChange={(key, values) => {
              setSearch({ [key]: values.length === 0 ? undefined : values });
            }}
            onOpenChange={setFiltering}
            open={filtering}
            project={project}
            search={search}
          />
          <DisplayOptions
            onChange={setSearch}
            projectKey={project.key}
            search={search}
            view={view}
          />
          <Button
            aria-keyshortcuts="C"
            className="max-md:hidden"
            onClick={() => {
              createIssue();
            }}
            size="pill"
            variant="ghost"
          >
            <PlusIcon data-icon="inline-start" />
            New issue
          </Button>
          <Button
            aria-keyshortcuts="C"
            aria-label="New issue"
            className="md:hidden"
            onClick={() => {
              createIssue();
            }}
            size="icon-round"
            variant="ghost"
          >
            <PlusIcon />
          </Button>
        </>
      )}
      className={cn("flex flex-col", view === "board" && "overflow-hidden")}
    >
      {(project) => (
        <>
          {isFiltered(search) ? (
            <FilterChips
              onChange={(key, values) => {
                setSearch({ [key]: values.length === 0 ? undefined : values });
              }}
              onClear={clearFilters}
              project={project}
              search={search}
            />
          ) : null}
          <div
            className={cn(
              "min-h-0 flex-1",
              view === "list" ? "overflow-y-auto" : "flex flex-col"
            )}
          >
            <Issues
              onClearFilters={clearFilters}
              project={project}
              search={search}
              view={view}
            />
          </div>
        </>
      )}
    </ProjectPage>
  );
};

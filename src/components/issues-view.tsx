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
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ListIcon,
  ListFilterIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { useCreateIssue } from "~/components/create-issue";
import {
  FilterChips,
  useProjectFilterOptions,
} from "~/components/issue-filters";
import type { ChangeFilter } from "~/components/issue-filters";
import { IssueListActions } from "~/components/issue-list-actions";
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
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/user-avatar";
import type {
  IssueField,
  IssueSummary,
  ProjectDetail,
  Status,
} from "~/lib/api-types";
import { rangeLabel, visibleRange } from "~/lib/board-range";
import type { ColumnRange } from "~/lib/board-range";
import { closeIssueMenu, selectByClick, toggleRow } from "~/lib/issue-focus";
import { openIssueRow, openPanel, usePanelShows } from "~/lib/issue-panel";
import {
  useSelected,
  useSelecting,
  useSelectionScope,
} from "~/lib/issue-selection";
import {
  filterIssues,
  filterKeys,
  formatDate,
  groupIssues,
  isClosedStatus,
  isFiltered,
  setStatusCollapsed,
  shownStatuses,
  useProjectView,
  setRailExpanded,
  useRailExpanded,
  useStatusCollapsed,
  sortKeyBetween,
  withKnown,
  withKnownLabels,
} from "~/lib/issue-view";
import type { IssueSearch, Order, ViewKind } from "~/lib/issue-view";
import {
  closedIssuesQuery,
  issueCountsQuery,
  issueQuery,
  labelsQuery,
  membersQuery,
  useWorkingSet,
} from "~/lib/queries";
import { rootRem } from "~/lib/rem";
import { useRemoteFlash } from "~/lib/remote-flash";
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
    preventActivation: (event) => !event.shiftKey,
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
  assignee?: boolean;
  columns: Columns;
  dragging: string | null;
  footer: (status: Status) => ReactNode;
  issues: Map<string, IssueSummary>;
  lookup: IssueLookup;
  onCreate: (status: Status) => void;
  onOpen: OpenIssue;
  statuses: Status[];
  total: (status: Status, loaded: number) => number;
}

export type OpenIssue = (
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

const shownFields = (
  issue: IssueSummary,
  assignee = true,
  labels = true
): IssueField[] => [
  "title",
  ...(issue.priority === 0 ? [] : (["priority"] as const)),
  ...(labels && issue.labelIds.length > 0 ? (["labels"] as const) : []),
  ...(assignee && issue.assigneeId !== null ? (["assignee"] as const) : []),
];

const ChangedBy = ({
  actorId,
  className,
  lookup,
}: {
  actorId: string;
  className?: string;
  lookup: IssueLookup;
}) => {
  const member = lookup.members.get(actorId);
  const name = member?.displayName ?? "A teammate";

  return (
    <span className={cn("flex shrink-0 items-center", className)}>
      <UserAvatar
        avatarUrl={member?.avatarUrl ?? ""}
        className="size-5"
        name={name}
      />
      <span className="sr-only">Changed by {name}</span>
    </span>
  );
};

const Sortable = ({
  children,
  className,
  group,
  index,
  issue,
  onOpen,
  shown,
}: {
  children: ReactNode;
  className: string;
  group: string;
  index: number;
  issue: IssueSummary;
  onOpen: OpenIssue;
  shown: IssueField[];
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
  const current = usePanelShows(issue.key);
  const remote = useRemoteFlash(id, shown).row;

  return (
    <button
      className={cn(className, isDragSource && "opacity-40", remote)}
      data-current={current ? "true" : undefined}
      data-issue={id}
      data-selected={selected ? "true" : undefined}
      onAuxClick={(event) => {
        if (event.button === 1) {
          onOpen(issue, "tab");
        }
      }}
      onClick={(event) => {
        if (
          !selectByClick(event, id) &&
          !(event.altKey && openPanel(issue.key))
        ) {
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
  "group/row group/issue relative flex min-h-11 w-full cursor-default flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md px-2 py-2 text-left outline-none select-none hover:bg-row-focus focus-visible:bg-row-focus focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset data-selected:bg-row-selected data-selected:hover:bg-row-selected-hover data-selected:focus-visible:bg-row-selected-hover data-menu-target:bg-row-focus data-current:bg-row-focus data-current:shadow-focus-bar data-selected:data-menu-target:bg-row-selected-hover md:h-9 md:min-h-0 md:flex-nowrap md:py-0 md:pointer-coarse:h-11";

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

export const listClass =
  "@container/list mx-auto flex w-full max-w-list flex-col px-2 pb-16";

export const RowContent = ({
  assignee = true,
  issue,
  lookup,
}: {
  assignee?: boolean;
  issue: IssueSummary;
  lookup: IssueLookup;
}) => {
  const remote = useRemoteFlash(issue.id, shownFields(issue, assignee, false));

  return (
    <>
      <RowCheck id={issue.id} />
      <span
        className={cn(
          "-m-1 flex shrink-0 rounded-sm p-1",
          issue.priority === 0 && "invisible",
          remote.field("priority")
        )}
      >
        <PriorityIcon priority={issue.priority} />
      </span>
      <span className="text-muted-foreground tracking-key shrink-0 whitespace-nowrap tabular-nums max-md:text-xs md:min-w-16">
        {issue.key}
      </span>
      <span
        className={cn(
          "order-first w-[calc(100%-1.875rem)] font-medium break-words max-md:line-clamp-2 md:order-none md:w-auto md:min-w-0 md:flex-1 md:truncate",
          (!assignee || issue.assigneeId === null) && "max-md:w-full",
          remote.field("title")
        )}
      >
        {issue.title}
      </span>
      <span
        className={cn(
          "flex max-w-[40%] min-w-0 shrink items-center gap-1 overflow-hidden empty:hidden md:w-40 md:max-w-none md:shrink-0 md:justify-end md:@max-3xl/list:hidden @5xl/list:hidden"
        )}
      >
        <IssueLabels issue={issue} lookup={lookup} max={1} />
      </span>
      <span
        className={cn(
          "hidden w-64 shrink-0 items-center justify-end gap-1 overflow-hidden @5xl/list:flex"
        )}
      >
        <IssueLabels issue={issue} lookup={lookup} max={2} />
      </span>
      <span className="contents md:flex md:w-10 md:shrink-0 md:items-center md:justify-end md:gap-1">
        <PullRequestIcon state={issue.pullRequestState} />
        <CiIcon state={issue.ciState} />
      </span>
      <span className="contents md:flex md:w-10 md:shrink-0 md:justify-end">
        <Checklist issue={issue} />
      </span>
      {assignee ? (
        <span
          className={cn(
            "order-first self-start md:order-none md:flex md:w-6 md:shrink-0 md:justify-end md:self-auto",
            issue.assigneeId === null && "max-md:contents"
          )}
        >
          <Assignee
            className={cn(
              issue.assigneeId !== null && "-m-1 rounded-full p-1",
              remote.field("assignee")
            )}
            issue={issue}
            lookup={lookup}
          />
        </span>
      ) : null}
      {remote.actorId === undefined ? (
        <time
          className="text-muted-foreground ml-auto w-14 shrink-0 text-right text-xs tabular-nums md:ml-0 md:w-16"
          dateTime={issue.updatedAt}
        >
          <span className="sr-only">Updated </span>
          {formatDate(issue.updatedAt)}
        </time>
      ) : (
        <ChangedBy
          actorId={remote.actorId}
          className="ml-auto w-14 justify-end md:ml-0 md:w-16"
          lookup={lookup}
        />
      )}
    </>
  );
};

const ListGroup = ({
  assignee,
  dragging,
  footer,
  ids,
  issues,
  lookup,
  onOpen,
  status,
  total,
}: Omit<ViewProps, "columns" | "onCreate" | "statuses"> & {
  ids: string[];
  status: Status;
}) => {
  const open = !useStatusCollapsed(status.id);
  const { isDropTarget, ref } = useColumn(status, !open);
  const shown = open ? ids : ids.filter((id) => id === dragging);

  return (
    <section
      aria-labelledby={`group-${status.id}`}
      className="not-first:mt-2"
      ref={ref}
    >
      <h2
        className="bg-background sticky top-0 z-10 border-b"
        id={`group-${status.id}`}
      >
        <button
          aria-expanded={open}
          className={cn(
            "hover:bg-row-focus focus-visible:bg-row-focus hit-area focus-visible:ring-ring relative flex h-8 w-full items-center gap-2 px-2 text-left font-medium outline-none focus-visible:ring-1 focus-visible:ring-inset",
            isDropTarget && "bg-row-selected"
          )}
          onClick={() => {
            setStatusCollapsed(status.id, open);
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
            shown={shownFields(issue, assignee, false)}
          >
            <RowContent assignee={assignee} issue={issue} lookup={lookup} />
          </Sortable>
        );
      })}
      {open ? footer(status) : null}
    </section>
  );
};

const List = ({
  columns,
  onCreate: _create,
  statuses,
  ...props
}: ViewProps) => (
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
  "group/issue relative flex w-full cursor-default flex-col gap-2 rounded-md bg-card p-3 ring-inset text-left shadow-card outline-none select-none hover:bg-surface-1 focus-visible:ring-1 focus-visible:ring-ring data-selected:bg-row-selected dark:bg-surface-2 dark:ring-1 dark:ring-border dark:hover:bg-surface-3 dark:data-selected:bg-row-selected data-selected:hover:bg-row-selected-hover dark:data-selected:hover:bg-row-selected-hover data-menu-target:bg-surface-1 dark:data-menu-target:bg-surface-3 data-current:bg-surface-1 data-current:ring-1 data-current:ring-primary dark:data-current:bg-surface-3 data-selected:data-menu-target:bg-row-selected-hover dark:data-selected:data-menu-target:bg-row-selected-hover";

const CardContent = ({
  assignee = true,
  issue,
  lookup,
}: {
  assignee?: boolean;
  issue: IssueSummary;
  lookup: IssueLookup;
}) => {
  const remote = useRemoteFlash(issue.id, shownFields(issue, assignee));

  return (
    <>
      <span className="flex flex-col gap-0.5">
        <span className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
          {issue.key}
          {remote.actorId === undefined ? null : (
            <ChangedBy
              actorId={remote.actorId}
              className="-my-0.5"
              lookup={lookup}
            />
          )}
          {assignee ? (
            <span className="ml-auto flex">
              <Assignee
                className={cn(
                  issue.assigneeId !== null && "-m-1 rounded-full p-1",
                  remote.field("assignee")
                )}
                issue={issue}
                lookup={lookup}
              />
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "line-clamp-2 font-medium break-words",
            remote.field("title")
          )}
        >
          {issue.title}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 empty:hidden">
        {issue.priority === 0 ? null : (
          <span
            className={cn("-m-1 flex rounded-sm p-1", remote.field("priority"))}
          >
            <PriorityIcon priority={issue.priority} />
          </span>
        )}
        <span className={cn("flex items-center gap-1.5 empty:hidden")}>
          <IssueLabels
            className={remote.field("labels")}
            issue={issue}
            lookup={lookup}
            max={1}
          />
        </span>
        <PullRequestIcon state={issue.pullRequestState} />
        <CiIcon state={issue.ciState} />
        <Checklist issue={issue} />
      </span>
    </>
  );
};

const toggleRail = (button: HTMLElement, id: string, expanded: boolean) => {
  const column = button.closest("section");

  setRailExpanded(id, expanded);
  requestAnimationFrame(() => {
    column?.querySelector<HTMLElement>("[data-rail-toggle]")?.focus();
  });
};

const BoardColumn = ({
  assignee,
  footer,
  ids,
  issues,
  lookup,
  onCreate,
  onOpen,
  railed,
  status,
  total,
}: Omit<ViewProps, "columns" | "dragging" | "statuses"> & {
  ids: string[];
  railed: boolean;
  status: Status;
}) => {
  const closed = railed && isClosedStatus(status);
  const expanded = useRailExpanded(status.id);
  const rail = closed && !expanded;
  const { isDropTarget, ref } = useColumn(status, rail);

  return (
    <section
      aria-labelledby={`column-${status.id}`}
      className={cn(
        "bg-surface-1 flex w-[340px] max-w-[85vw] shrink-0 snap-start flex-col rounded-md transition-colors duration-150 md:w-auto md:max-w-96 md:min-w-60 md:flex-1 md:basis-0",
        rail && "md:w-10 md:min-w-0 md:flex-none",
        isDropTarget && "bg-row-selected"
      )}
      data-column={status.id}
      ref={ref}
    >
      {rail ? (
        <button
          aria-expanded={false}
          className="hover:bg-surface-2 focus-visible:ring-ring flex min-h-0 flex-1 flex-col items-center gap-2 rounded-md py-4 outline-none focus-visible:ring-2"
          data-rail-toggle
          onClick={(event) => {
            toggleRail(event.currentTarget, status.id, true);
          }}
          type="button"
        >
          <StatusIcon category={status.category} color={status.color} />
          <span
            className="font-medium [writing-mode:vertical-rl]"
            id={`column-${status.id}`}
          >
            {status.name}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {total(status, ids.length)}
          </span>
        </button>
      ) : (
        <>
          <header className="flex h-[50px] shrink-0 items-center gap-2 px-3 max-md:sr-only">
            <StatusIcon category={status.category} color={status.color} />
            <h2 className="truncate font-medium" id={`column-${status.id}`}>
              {status.name}
            </h2>
            <span className="text-muted-foreground tabular-nums">
              {total(status, ids.length)}
            </span>
            <Button
              aria-label={`New issue in ${status.name}`}
              className="ml-auto max-md:hidden"
              onClick={() => {
                onCreate(status);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <PlusIcon />
            </Button>
            {closed ? (
              <Button
                aria-expanded
                aria-label={`Collapse ${status.name}`}
                data-rail-toggle
                onClick={(event) => {
                  toggleRail(event.currentTarget, status.id, false);
                }}
                size="icon-xs"
                variant="ghost"
              >
                <ChevronsLeftIcon />
              </Button>
            ) : null}
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.25 pb-2 max-md:pt-2.25">
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
                  shown={shownFields(issue, assignee)}
                >
                  <CardContent
                    assignee={assignee}
                    issue={issue}
                    lookup={lookup}
                  />
                </Sortable>
              );
            })}
            {footer(status)}
            <Button
              aria-label={`New issue in ${status.name}`}
              className="h-11 justify-start md:hidden"
              onClick={() => {
                onCreate(status);
              }}
              variant="ghost"
            >
              <PlusIcon data-icon="inline-start" />
              New issue
            </Button>
          </div>
        </>
      )}
    </section>
  );
};

const ColumnJump = ({
  board,
  columns,
  statuses,
  total,
}: Pick<ViewProps, "columns" | "statuses" | "total"> & {
  board: RefObject<HTMLDivElement | null>;
}) => {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const element = board.current;

    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const { intersectionRatio, target } of entries) {
          const id =
            target instanceof HTMLElement
              ? target.dataset["column"]
              : undefined;

          if (id !== undefined && intersectionRatio >= 0.6) {
            visible.add(id);
          } else if (id !== undefined) {
            visible.delete(id);
          }
        }

        const first = statuses.find((status) => visible.has(status.id));

        if (first !== undefined) {
          setActive(first.id);
        }
      },
      { root: element, threshold: 0.6 }
    );

    for (const status of statuses) {
      const column = element?.querySelector(
        `[data-column="${CSS.escape(status.id)}"]`
      );

      if (column !== null && column !== undefined) {
        observer.observe(column);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [board, statuses]);

  const current = active ?? statuses[0]?.id;
  const chips = useRef<HTMLElement>(null);

  useEffect(() => {
    const chip =
      current === undefined
        ? null
        : chips.current?.querySelector(`[data-chip="${CSS.escape(current)}"]`);

    if (chip instanceof HTMLElement && chips.current !== null) {
      chips.current.scrollTo({
        behavior: "smooth",
        left:
          chip.offsetLeft -
          chips.current.clientWidth / 2 +
          chip.clientWidth / 2,
      });
    }
  }, [current]);

  return (
    <nav
      aria-label="Board columns"
      className="fade-x flex shrink-0 gap-1 overflow-x-auto px-4 pt-2 md:hidden"
      ref={chips}
    >
      {statuses.map((status) => (
        <Button
          aria-current={status.id === current ? "true" : undefined}
          className="shrink-0"
          data-chip={status.id}
          key={status.id}
          onClick={() => {
            board.current
              ?.querySelector(`[data-column="${CSS.escape(status.id)}"]`)
              ?.scrollIntoView({ block: "nearest", inline: "start" });
          }}
          size="sm"
          variant={status.id === current ? "outline" : "ghost"}
        >
          <StatusIcon category={status.category} color={status.color} />
          {status.name}
          <span className="text-muted-foreground tabular-nums">
            {total(status, columns[status.id]?.length ?? 0)}
          </span>
        </Button>
      ))}
    </nav>
  );
};

const useColumnRange = (
  board: RefObject<HTMLDivElement | null>,
  statuses: Status[]
) => {
  const [range, setRange] = useState<ColumnRange | null>(null);
  const ids = statuses.map((status) => status.id).join(" ");

  useEffect(() => {
    const element = board.current;
    const order = ids.split(" ");
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const { intersectionRatio, target } of entries) {
          const id =
            target instanceof HTMLElement
              ? target.dataset["column"]
              : undefined;

          if (id !== undefined && intersectionRatio >= 0.95) {
            visible.add(id);
          } else if (id !== undefined) {
            visible.delete(id);
          }
        }

        setRange(visibleRange(order, visible));
      },
      { root: element, threshold: [0, 0.95, 1] }
    );

    for (const column of element?.querySelectorAll("[data-column]") ?? []) {
      observer.observe(column);
    }

    return () => {
      observer.disconnect();
    };
  }, [board, ids]);

  return range;
};

const jumpLabel = (more: boolean, range: ColumnRange | null) => {
  const action = more ? "Show more columns" : "Show first columns";

  return range === null ? action : `${action}, ${rangeLabel(range)} shown`;
};

const ColumnRangeButton = ({
  board,
  more,
  range,
}: {
  board: RefObject<HTMLDivElement | null>;
  more: boolean;
  range: ColumnRange | null;
}) => (
  <Button
    aria-label={jumpLabel(more, range)}
    className="absolute right-4 bottom-4 z-10 max-md:hidden"
    onClick={() => {
      const element = board.current;

      const next =
        more && range !== null
          ? element?.querySelectorAll<HTMLElement>("[data-column]")[range.last]
          : undefined;

      element?.scrollTo({
        behavior: "smooth",
        left: next === undefined ? 0 : next.offsetLeft - element.offsetLeft,
      });
    }}
    size="pill"
    variant="outline"
  >
    <span className="tabular-nums">
      {range === null ? "Columns" : rangeLabel(range)}
    </span>
    {more ? (
      <ChevronRightIcon data-icon="inline-end" />
    ) : (
      <ChevronLeftIcon data-icon="inline-end" />
    )}
  </Button>
);

const useOverflowing = (board: RefObject<HTMLDivElement | null>) => {
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = board.current;

    const measure = () => {
      setOverflowing(
        element !== null && element.scrollWidth > element.clientWidth + 1
      );
    };

    const observer = new ResizeObserver(measure);

    if (element !== null) {
      measure();
      observer.observe(element);

      for (const child of element.children) {
        observer.observe(child);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [board]);

  return overflowing;
};

const railsBelow = 100;

const useRailed = (board: RefObject<HTMLDivElement | null>) => {
  const [railed, setRailed] = useState(false);

  useLayoutEffect(() => {
    const element = board.current;
    const tablet = matchMedia("(min-width: 48rem)");

    const measure = () => {
      setRailed(
        element !== null &&
          tablet.matches &&
          element.clientWidth < railsBelow * rootRem()
      );
    };

    const observer = new ResizeObserver(measure);

    if (element !== null) {
      measure();
      observer.observe(element);
    }

    tablet.addEventListener("change", measure);

    return () => {
      observer.disconnect();
      tablet.removeEventListener("change", measure);
    };
  }, [board]);

  return railed;
};

const Board = ({ columns, statuses, ...props }: ViewProps) => {
  const board = useRef<HTMLDivElement>(null);
  const railed = useRailed(board);
  const range = useColumnRange(board, statuses);
  const more = range === null || range.last < range.count;
  const scrolled = range !== null && range.first > 1;
  const overflowing = useOverflowing(board);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ColumnJump
        board={board}
        columns={columns}
        statuses={statuses}
        total={props.total}
      />
      <div className="relative flex min-h-0 flex-1">
        <div
          className={cn(
            "fade-edges flex min-h-0 min-w-0 flex-1 snap-x snap-mandatory scroll-px-2 gap-2 overflow-x-auto p-2 md:snap-proximity",
            overflowing && more && "fade-edges-end",
            overflowing && scrolled && "fade-edges-start"
          )}
          data-board
          ref={board}
        >
          {statuses.map((status) => (
            <BoardColumn
              ids={columns[status.id] ?? []}
              key={status.id}
              railed={railed}
              status={status}
              {...props}
            />
          ))}
        </div>
        {overflowing ? (
          <ColumnRangeButton board={board} more={more} range={range} />
        ) : null}
      </div>
    </div>
  );
};

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

const useClosedIssues = (
  project: ProjectDetail,
  search: IssueSearch,
  truncated: boolean
) => {
  const enabled = search.closed === true;

  const closed = useInfiniteQuery({
    ...closedIssuesQuery(project, search),
    enabled,
  });

  const counts = useQuery({
    ...issueCountsQuery(project, search),
    enabled: enabled || truncated,
  });

  const totals = new Map(
    counts.data?.map((count) => [count.statusId, count.count])
  );

  const recents = new Map(
    counts.data?.map((count) => [count.statusId, count.recent])
  );

  const total = (status: Status, loaded: number) => {
    const counted = isClosedStatus(status) ? enabled : truncated;

    return counted ? Math.max(loaded, totals.get(status.id) ?? 0) : loaded;
  };

  const hasOlder = (status: Status, loaded: number) => {
    if (!enabled || !isClosedStatus(status) || !closed.hasNextPage) {
      return false;
    }

    return counts.data === undefined || loaded < total(status, loaded);
  };

  const shown = (status: Status, loaded: number) =>
    isClosedStatus(status)
      ? Math.max(loaded, recents.get(status.id) ?? 0)
      : total(status, loaded);

  const isCut = (status: Status, loaded: number) =>
    truncated &&
    !(enabled && isClosedStatus(status)) &&
    loaded < shown(status, loaded);

  return { closed, hasOlder, isCut, shown, total };
};

const acceptAll = () => true;

export type MoveIssue = (
  issue: IssueSummary,
  to: { ids: string[]; index: number; statusId: string }
) => void;

export const IssueLayout = ({
  accepts = acceptAll,
  columns: sorted,
  issues: byId,
  manualIn,
  onMove,
  view,
  ...rest
}: Omit<ViewProps, "dragging"> & {
  accepts?: (issue: IssueSummary, statusId: string) => boolean;
  manualIn: (statusId: string) => boolean;
  onMove: MoveIssue;
  view: ViewKind;
}) => {
  const [drag, setDrag] = useState<{ columns: Columns; id: string } | null>(
    null
  );

  const columns = drag?.columns ?? sorted;

  const onDragOver: DragDropEventHandlers["onDragOver"] = (event) => {
    const { source, target } = event.operation;

    if (!isSortable(source)) {
      return;
    }

    const issue = byId.get(String(source.id));
    const group = isSortable(target) ? target.group : target?.id;
    const reorder = isSortable(target) && source.group === target.group;

    const foreign =
      group !== undefined &&
      group !== source.group &&
      issue !== undefined &&
      !accepts(issue, String(group));

    const blocked = reorder ? !manualIn(String(group)) : foreign;

    if (blocked) {
      event.preventDefault();

      if (foreign) {
        setDrag((current) =>
          current === null ? null : { ...current, columns: sorted }
        );
      }

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

    if (
      from?.statusId === to.statusId &&
      (!manualIn(to.statusId) || from.index === to.index)
    ) {
      return;
    }

    onMove(issue, to);
  };

  const props: ViewProps = {
    ...rest,
    columns,
    dragging: drag?.id ?? null,
    issues: byId,
  };

  return (
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
                <CardContent
                  assignee={rest.assignee}
                  issue={issue}
                  lookup={rest.lookup}
                />
              ) : (
                <RowContent
                  assignee={rest.assignee}
                  issue={issue}
                  lookup={rest.lookup}
                />
              )}
            </div>
          );
        }}
      </DragOverlay>
    </DragDropProvider>
  );
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
  const { query: issues, truncated } = useWorkingSet(project, search);

  const { closed, hasOlder, isCut, shown, total } = useClosedIssues(
    project,
    search,
    truncated
  );

  const members = useQuery(membersQuery(workspace.slug));
  const labels = useQuery(labelsQuery(workspace.slug));
  const updateIssue = useUpdateIssue();

  const createIssue = useCreateIssue();
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

  const onMove: MoveIssue = (issue, to) => {
    const patch: IssuePatch = { statusId: to.statusId };

    if (manualIn(to.statusId)) {
      patch.sortKey = sortKeyBetween(
        byId.get(to.ids[to.index - 1] ?? "")?.sortKey,
        byId.get(to.ids[to.index + 1] ?? "")?.sortKey
      );
    }

    updateIssue(issue, patch);
  };

  const statuses = shownStatuses(project.statuses, search);

  const footer = (status: Status) => {
    const loaded = sorted[status.id]?.length ?? 0;

    return (
      <>
        {visible.length === 0 && status.id === statuses[0]?.id ? (
          <FirstIssue statusId={status.id} />
        ) : null}
        {isCut(status, loaded) ? (
          <p className="text-muted-foreground m-1.5 text-xs">
            Showing {loaded} of {shown(status, loaded)}. Filter to see the rest.
          </p>
        ) : null}
        {hasOlder(status, loaded) ? (
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
  };

  const onOpen: OpenIssue = (issue, how) => {
    if (issue.version === 0) {
      return;
    }

    if (how === "prefetch") {
      queryClient.query(issueQuery(project.id, issue.key)).catch(() => null);
    } else if (how === "tab") {
      window.open(`/${workspace.slug}/issue/${issue.key}`, "_blank");
    } else if (!openIssueRow(issue.key)) {
      void navigate({
        params: { issueKey: issue.key, slug: workspace.slug },
        state: { from: { projectKey: project.key, search, view }, full: true },
        to: "/$slug/issue/$issueKey",
      });
    }
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
      <IssueLayout
        columns={sorted}
        footer={footer}
        issues={byId}
        lookup={lookup}
        manualIn={manualIn}
        onCreate={(status) => {
          createIssue({ statusId: status.id });
        }}
        onMove={onMove}
        onOpen={onOpen}
        statuses={statuses}
        total={total}
        view={view}
      />
    </>
  );
};

const orders = [
  { label: "Manual", value: "manual" },
  { label: "Priority", value: "priority" },
  { label: "Last updated", value: "updated" },
] as const;

const ProjectActions = ({
  onFilter,
  project,
  search,
  setSearch,
  view,
}: {
  onFilter: ChangeFilter;
  project: ProjectDetail;
  search: IssueSearch;
  setSearch: (patch: IssueSearch) => void;
  view: ViewKind;
}) => (
  <IssueListActions
    closed={search.closed === true}
    filter={{
      keys: filterKeys,
      onChange: onFilter,
      options: useProjectFilterOptions(project.statuses),
      values: search,
    }}
    onClosed={(all) => {
      setSearch({ closed: all ? true : undefined });
    }}
    onOrder={(order) => {
      setSearch({ order: order === "manual" ? undefined : order });
    }}
    order={search.order ?? "manual"}
    orders={orders}
    view={view}
    viewKey={project.key}
  />
);

const ProjectFilterChips = ({
  onChange,
  onClear,
  project,
  search,
}: {
  onChange: ChangeFilter;
  onClear: () => void;
  project: ProjectDetail;
  search: IssueSearch;
}) => (
  <FilterChips
    keys={filterKeys}
    onChange={onChange}
    onClear={onClear}
    options={useProjectFilterOptions(project.statuses)}
    values={search}
  />
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

  const onFilter: ChangeFilter = (key, values) => {
    setSearch({ [key]: values.length === 0 ? undefined : values });
  };

  const knownIn = (project: ProjectDetail) =>
    withKnown(
      search,
      "status",
      project.statuses.map((status) => status.id)
    );

  return (
    <ProjectPage
      bounded={view === "list"}
      renderActions={(project) => (
        <ProjectActions
          onFilter={onFilter}
          project={project}
          search={knownIn(project)}
          setSearch={setSearch}
          view={view}
        />
      )}
      className={cn("flex flex-col", view === "board" && "overflow-hidden")}
    >
      {(project) => {
        const known = knownIn(project);

        return (
          <>
            {isFiltered(known) ? (
              <ProjectFilterChips
                onChange={onFilter}
                onClear={clearFilters}
                project={project}
                search={known}
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
                search={known}
                view={view}
              />
            </div>
          </>
        );
      }}
    </ProjectPage>
  );
};

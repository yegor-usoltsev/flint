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
import type { IssueSummary, ProjectDetail, Status } from "~/lib/api-types";
import { closeIssueMenu, selectByClick, toggleRow } from "~/lib/issue-focus";
import { openPanel, showInPanel, usePanelShows } from "~/lib/issue-panel";
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
  useStatusCollapsed,
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
  const current = usePanelShows(issue.key);
  const remote = useRemoteFlash(id);

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
  "group/row group/issue relative flex min-h-11 w-full cursor-default flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md px-2 py-2 text-left outline-none select-none hover:bg-row-focus focus-visible:bg-row-focus focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset data-selected:bg-row-selected data-selected:hover:bg-row-selected-hover data-selected:focus-visible:bg-row-selected-hover data-menu-target:bg-row-focus data-current:bg-row-focus data-current:shadow-focus-bar data-selected:data-menu-target:bg-row-selected-hover md:h-11 md:min-h-0 md:flex-nowrap md:py-0";

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
  "@container/list flex max-w-list flex-col gap-1 px-2 pt-2 pb-16";

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
  assignee = true,
  issue,
  lookup,
}: {
  assignee?: boolean;
  issue: IssueSummary;
  lookup: IssueLookup;
}) => (
  <>
    <RowCheck id={issue.id} />
    <PriorityIcon
      className={cn(issue.priority === 0 && "invisible")}
      priority={issue.priority}
    />
    <span className="text-muted-foreground tracking-key shrink-0 whitespace-nowrap tabular-nums max-md:text-xs md:min-w-16">
      {issue.key}
    </span>
    <IssueStatus issue={issue} lookup={lookup} />
    <span
      className={cn(
        "order-first w-[calc(100%-1.875rem)] font-medium break-words max-md:line-clamp-2 md:order-none md:w-auto md:min-w-0 md:flex-1 md:truncate @min-[80rem]/list:max-w-160",
        (!assignee || issue.assigneeId === null) && "max-md:w-full"
      )}
    >
      {issue.title}
    </span>
    <span className="flex max-w-[40%] min-w-0 shrink items-center gap-1 overflow-hidden @max-[80rem]/list:empty:hidden md:@max-3xl/list:hidden @min-[80rem]/list:w-80 @min-[80rem]/list:max-w-none @min-[80rem]/list:shrink-0 @max-4xl/list:[&>:nth-child(n+2)]:hidden">
      <IssueLabels issue={issue} lookup={lookup} />
    </span>
    {issue.labelIds.length > 1 ? (
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums md:@max-3xl/list:hidden @4xl/list:hidden">
        +{issue.labelIds.length - 1}
      </span>
    ) : null}
    <span className="contents @min-[80rem]/list:flex @min-[80rem]/list:w-20 @min-[80rem]/list:items-center @min-[80rem]/list:justify-end @min-[80rem]/list:gap-2.5">
      <PullRequestIcon state={issue.pullRequestState} />
      <CiIcon state={issue.ciState} />
      <Checklist issue={issue} />
    </span>
    {assignee ? (
      <Assignee
        className="order-first self-start md:order-none md:self-auto"
        issue={issue}
        lookup={lookup}
      />
    ) : null}
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
    <section aria-labelledby={`group-${status.id}`} ref={ref}>
      <h2 className="bg-background sticky top-0 z-10" id={`group-${status.id}`}>
        <button
          aria-expanded={open}
          className={cn(
            "bg-group-header hover:bg-group-header-hover focus-visible:bg-group-header-hover hit-area relative flex h-9 w-full items-center gap-2 rounded-md px-2 text-left font-medium outline-none",
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
  "group/issue relative flex w-full cursor-default flex-col gap-2 rounded-md bg-card p-3 text-left shadow-card outline-none select-none hover:bg-surface-1 focus-visible:ring-1 focus-visible:ring-ring data-selected:bg-row-selected dark:bg-surface-2 dark:ring-1 dark:ring-border dark:hover:bg-surface-3 dark:data-selected:bg-row-selected data-selected:hover:bg-row-selected-hover dark:data-selected:hover:bg-row-selected-hover data-menu-target:bg-surface-1 dark:data-menu-target:bg-surface-3 data-current:bg-surface-1 data-current:ring-1 data-current:ring-primary dark:data-current:bg-surface-3 data-selected:data-menu-target:bg-row-selected-hover dark:data-selected:data-menu-target:bg-row-selected-hover";

const CardContent = ({
  assignee = true,
  issue,
  lookup,
}: {
  assignee?: boolean;
  issue: IssueSummary;
  lookup: IssueLookup;
}) => (
  <>
    <span className="flex flex-col gap-0.5">
      <span className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
        {issue.key}
        {assignee ? (
          <Assignee className="ml-auto" issue={issue} lookup={lookup} />
        ) : null}
      </span>
      <span className="line-clamp-2 font-medium break-words">
        {issue.title}
      </span>
    </span>
    <span className="flex flex-wrap items-center gap-1.5 empty:hidden">
      {issue.priority === 0 ? null : <PriorityIcon priority={issue.priority} />}
      <IssueLabels issue={issue} lookup={lookup} max={1} />
      <PullRequestIcon state={issue.pullRequestState} />
      <CiIcon state={issue.ciState} />
      <Checklist issue={issue} />
    </span>
  </>
);

const BoardColumn = ({
  assignee,
  footer,
  ids,
  issues,
  lookup,
  onCreate,
  onOpen,
  status,
  total,
}: Omit<ViewProps, "columns" | "dragging" | "statuses"> & {
  ids: string[];
  status: Status;
}) => {
  const { isDropTarget, ref } = useColumn(status);

  return (
    <section
      aria-labelledby={`column-${status.id}`}
      className={cn(
        "bg-surface-1 flex w-[340px] max-w-[85vw] shrink-0 snap-start flex-col rounded-md transition-colors duration-150 md:w-(--column) md:max-w-none",
        isDropTarget && "bg-row-selected"
      )}
      data-column={status.id}
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
            onCreate(status);
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
              <CardContent assignee={assignee} issue={issue} lookup={lookup} />
            </Sortable>
          );
        })}
        {footer(status)}
      </div>
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

const useMoreRight = (
  board: RefObject<HTMLDivElement | null>,
  last: string | undefined
) => {
  const [more, setMore] = useState(false);

  useEffect(() => {
    const element = board.current;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setMore(entry !== undefined && entry.intersectionRatio < 0.99);
      },
      { root: element, threshold: [0, 0.99] }
    );

    const column =
      last === undefined
        ? null
        : element?.querySelector(`[data-column="${CSS.escape(last)}"]`);

    if (column !== null && column !== undefined) {
      observer.observe(column);
    }

    return () => {
      observer.disconnect();
    };
  }, [board, last]);

  return more;
};

const columnGapRem = 0.5;
const columnMinRem = 15;
const columnMaxRem = 25;
const buttonStripRem = 3;

const rootRem = () =>
  Number(
    getComputedStyle(document.documentElement).fontSize.replace(/px$/u, "")
  ) || 16;

const useColumnWidth = (
  board: RefObject<HTMLDivElement | null>,
  count: number
) => {
  const [layout, setLayout] = useState({ fits: true, step: 0, width: 288 });

  useLayoutEffect(() => {
    const element = board.current;

    const measure = () => {
      const rem = rootRem();
      const gap = columnGapRem * rem;
      const columnMin = columnMinRem * rem;
      const columnMax = columnMaxRem * rem;
      const inner = (element?.clientWidth ?? 0) - gap * 2;
      const all = (inner - gap * (count - 1)) / count;

      if (all >= columnMin) {
        setLayout({ fits: true, step: 0, width: Math.min(all, columnMax) });

        return;
      }

      const room = inner - buttonStripRem * rem;
      const shown = Math.max(1, Math.floor((room + gap) / (columnMin + gap)));
      const width = Math.min((room - gap * (shown - 1)) / shown, columnMax);

      setLayout({ fits: false, step: shown * (width + gap), width });
    };

    const observer = new ResizeObserver(measure);

    if (element !== null) {
      measure();
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [board, count]);

  return layout;
};

const Board = ({ columns, statuses, ...props }: ViewProps) => {
  const frame = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const more = useMoreRight(board, statuses.at(-1)?.id);
  const layout = useColumnWidth(frame, statuses.length);
  const shownWidth = useRef(layout.width);

  useLayoutEffect(() => {
    const element = board.current;
    const previous = shownWidth.current;

    shownWidth.current = layout.width;

    if (
      element !== null &&
      previous !== layout.width &&
      window.matchMedia("(min-width: 48rem)").matches
    ) {
      const gap = columnGapRem * rootRem();
      const first = Math.round(element.scrollLeft / (previous + gap));

      element.scrollLeft = first * (layout.width + gap);
    }
  }, [layout.width]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ColumnJump
        board={board}
        columns={columns}
        statuses={statuses}
        total={props.total}
      />
      <div className="flex min-h-0 flex-1" ref={frame}>
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 snap-x snap-mandatory scroll-px-2 gap-2 overflow-x-auto p-2 md:snap-none",
            more && "max-md:fade-right"
          )}
          data-board
          ref={board}
          style={{ "--column": `${layout.width}px` }}
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
        {layout.fits ? null : (
          <div className="flex w-12 shrink-0 justify-center pt-4.5 max-md:hidden">
            <Button
              aria-label={more ? "Show more columns" : "Show first columns"}
              onClick={() => {
                const element = board.current;

                element?.scrollTo({
                  behavior: "smooth",
                  left: more ? element.scrollLeft + layout.step : 0,
                });
              }}
              size="icon-round"
              variant="outline"
            >
              {more ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </Button>
          </div>
        )}
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
  const issues = useQuery(issuesQuery(project));

  const { closed, hasOlder, total } = useClosedIssues(project, search);

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

  const footer = (status: Status) => (
    <>
      {visible.length === 0 && status.id === statuses[0]?.id ? (
        <FirstIssue statusId={status.id} />
      ) : null}
      {hasOlder(status, sorted[status.id]?.length ?? 0) ? (
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
    } else if (!showInPanel(issue.key)) {
      void navigate({
        params: { issueKey: issue.key, slug: workspace.slug },
        state: { from: { projectKey: project.key, search, view } },
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

  return (
    <ProjectPage
      renderActions={(project) => (
        <ProjectActions
          onFilter={onFilter}
          project={project}
          search={search}
          setSearch={setSearch}
          view={view}
        />
      )}
      className={cn("flex flex-col", view === "board" && "overflow-hidden")}
    >
      {(project) => (
        <>
          {isFiltered(search) ? (
            <ProjectFilterChips
              onChange={onFilter}
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

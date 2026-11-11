import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import {
  Link,
  linkOptions,
  Navigate,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { cn } from "cn";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  EllipsisIcon,
  GitBranchIcon,
  LinkIcon,
  Maximize2Icon,
  PaperclipIcon,
  PanelRightIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { AttachButton } from "~/components/attach-button";
import { ConflictDialog, SaveState } from "~/components/conflict-dialog";
import { IssueAttachments } from "~/components/issue-attachments";
import { IssueDevelopment } from "~/components/issue-development";
import { Hint } from "~/components/issue-parts";
import { IssueProperties, PillButton } from "~/components/issue-properties";
import { IssueTimeline } from "~/components/issue-timeline";
import { LoadFailed } from "~/components/load-failed";
import type { MarkdownEditorHandle } from "~/components/markdown-editor";
import { MarkdownField, SourceToggle } from "~/components/markdown-view";
import { MenuKeys } from "~/components/menu-filter";
import { Page } from "~/components/page";
import { PresenceAvatars } from "~/components/presence-avatars";
import { RouteNotFound } from "~/components/route-not-found";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "~/components/ui/alert";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Skeleton } from "~/components/ui/skeleton";
import { api, isNotFound, useMe, useUsername } from "~/lib/api";
import type {
  Attachment,
  Issue,
  IssueSummary,
  ProjectDetail,
} from "~/lib/api-types";
import { branchName } from "~/lib/branch";
import { copyText, issueUrl } from "~/lib/copy";
import { useDeleteIssue } from "~/lib/issue-actions";
import {
  findIssue,
  findIssueByKey,
  rowOrder,
  useContextIssue,
} from "~/lib/issue-focus";
import {
  stepFromPanel,
  useWideEntry,
  panelVisible,
  usePanel,
  usePanelFits,
  usePanelOpen,
} from "~/lib/issue-panel";
import { orderIssues } from "~/lib/issue-view";
import type { IssueOrigin } from "~/lib/issue-view";
import { useMyIssues } from "~/lib/my-issues";
import {
  closedIssuesQuery,
  issueQuery,
  prefetchIssue,
  projectQuery,
  useWorkingSet,
} from "~/lib/queries";
import { forgetRecentHrefs, issueHref, useRememberRecent } from "~/lib/recent";
import type { RecentItem } from "~/lib/recent";
import { usePageTitle } from "~/lib/site";
import { useIssueDraft } from "~/lib/use-draft";
import { useHotkey } from "~/lib/use-hotkey";
import { findCachedIssue, useUpdateIssue } from "~/lib/use-update-issue";
import { useWorkspace } from "~/lib/use-workspace";

const placeholderIssue = (summary: IssueSummary): Issue => ({
  ...summary,
  deletedAt: null,
  description: "",
  links: [],
});

const useOrigin = (project: ProjectDetail): IssueOrigin => {
  const from = useLocation({ select: (location) => location.state.from });

  if (
    from?.view === "mine" ||
    from?.projectKey === project.key ||
    from?.panel !== undefined
  ) {
    return from;
  }

  return { projectKey: project.key, search: {}, view: "list" };
};

const usePainted = (ready: boolean) => {
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    let timer = 0;

    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        if (ready) {
          setPainted(true);
        }
      }, 0);
    });

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [ready]);

  return painted;
};

const useNeighbors = (project: ProjectDetail, key: string, ready: boolean) => {
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const origin = useOrigin(project);
  const mine = origin.view === "mine";
  const search = mine ? {} : origin.search;
  const painted = usePainted(ready);

  const open =
    useWorkingSet(project, search, !mine && painted).query.data ?? [];

  const assigned = useMyIssues(workspace.slug, mine ? origin.search : {}, mine);

  const closed =
    search.closed === true
      ? (queryClient
          .getQueryData<InfiniteData<IssueSummary[]>>(
            closedIssuesQuery(project, search).queryKey
          )
          ?.pages.flat() ?? [])
      : [];

  const ids = new Set(open.map((issue) => issue.id));

  const issues =
    origin.view === "mine"
      ? assigned.ordered
      : orderIssues(
          [...open, ...closed.filter((issue) => !ids.has(issue.id))],
          project.statuses,
          search
        );

  const live = issues.map((issue) => issue.key);
  const entry = useLocation({ select: (location) => location.state.__TSR_key });
  const passed = useLocation({ select: (location) => location.state.walk });
  const start = passed?.includes(key) === true ? passed : live;
  const [walk, setWalk] = useState({ entry, keys: start });

  if (
    walk.entry !== entry ||
    (!walk.keys.includes(key) && live.includes(key))
  ) {
    setWalk({ entry, keys: start });
  }

  const keys = walk.keys.includes(key) ? walk.keys : live;
  const index = keys.indexOf(key);

  return {
    count: keys.length,
    index,
    issues,
    keys,
    next: keys[index + 1],
    origin,
    previous: keys[index - 1],
    statuses: mine
      ? assigned.statuses
      : new Map(project.statuses.map((item) => [item.id, item])),
  };
};

const originCrumb = (
  origin: IssueOrigin,
  project: ProjectDetail,
  slug: string
) =>
  origin.view === "mine"
    ? {
        label: "My issues",
        short: "My issues",
        link: (
          <Link
            params={{ slug }}
            search={{ ...origin.search, issue: origin.panel }}
            to="/$slug/my-issues"
          />
        ),
      }
    : {
        label:
          origin.projectKey === project.key ? project.name : origin.projectKey,
        short:
          origin.projectKey === project.key ? project.name : origin.projectKey,
        link: (
          <Link
            params={{ key: origin.projectKey, slug }}
            search={{ ...origin.search, issue: origin.panel }}
            to="/$slug/project/$key"
          />
        ),
      };

const useBack = (origin: IssueOrigin) => {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const { slug } = workspace;

  return () => {
    if (origin.view === "mine") {
      void navigate({
        params: { slug },
        search: { ...origin.search, issue: origin.panel },
        to: "/$slug/my-issues",
      });
    } else {
      void navigate({
        params: { key: origin.projectKey, slug },
        search: { ...origin.search, issue: origin.panel },
        to: "/$slug/project/$key",
      });
    }
  };
};

const Title = ({
  editable,
  issue,
  onDone,
}: {
  editable: boolean;
  issue: Issue;
  onDone: () => void;
}) => {
  const title = useIssueDraft(issue, "title", null);

  return (
    <>
      <textarea
        aria-label="Title"
        className="placeholder:text-muted-foreground text-title field-sizing-content w-full resize-none bg-transparent outline-none"
        onBlur={() => {
          if (title.value.trim() === "") {
            title.handleDiscard();
          } else {
            title.handleFlush();
          }
        }}
        onChange={(event) => {
          title.handleChange(event.target.value.replaceAll("\n", " "));
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            onDone();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            title.handleDiscard();
            // oxlint-disable-next-line github/no-blur -- Escape leaves the text field, so single-key shortcuts work next.
            event.currentTarget.blur();
          }
        }}
        placeholder="Issue title"
        readOnly={!editable}
        rows={1}
        value={title.value}
      />
      {title.status === "error" ? (
        <div className="-mt-3 flex">
          <SaveState onRetry={title.handleFlush} status="error" />
        </div>
      ) : null}
      <ConflictDialog
        field="title"
        mine={title.value}
        onKeepMine={title.handleKeepMine}
        onUseTheirs={title.handleDiscard}
        saved={title.conflict}
      />
    </>
  );
};

const attachmentsId = (issue: Issue) => `attachments-${issue.id}`;

const AttachmentsChip = ({ issue }: { issue: Issue }) => {
  const count = useQuery({
    queryFn: async () =>
      await api<Attachment[]>(`/issues/${issue.key}/attachments`),
    queryKey: ["attachments", issue.id],
  }).data?.length;

  const sectionId = attachmentsId(issue);
  const [sectionInView, setSectionInView] = useState(false);

  useEffect(() => {
    const section = document.querySelector(`#${CSS.escape(sectionId)}`);

    const observer = new IntersectionObserver(
      ([entry]) => {
        setSectionInView((entry?.intersectionRatio ?? 0) >= 0.5);
      },
      { threshold: 0.5 }
    );

    if (section !== null) {
      observer.observe(section);
    }

    return () => {
      observer.disconnect();
    };
  }, [sectionId]);

  if (count === undefined || count === 0 || sectionInView) {
    return null;
  }

  return (
    <PillButton
      aria-label={count === 1 ? "1 attachment" : `${count} attachments`}
      onClick={() => {
        const section = document.querySelector<HTMLElement>(
          `#${CSS.escape(sectionId)}`
        );

        section?.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
        section?.focus({ preventScroll: true });
      }}
    >
      <PaperclipIcon aria-hidden className="text-muted-foreground size-3.5" />
      <span className="tabular-nums">{count}</span>
    </PillButton>
  );
};

const Description = ({
  attachments,
  editable,
  editor,
  issue,
}: {
  attachments: boolean;
  editable: boolean;
  editor: RefObject<MarkdownEditorHandle | null>;
  issue: Issue;
}) => {
  const description = useIssueDraft(issue, "description", 600);
  const [source, setSource] = useState(false);
  const [pressing, setPressing] = useState(false);

  const busy = ["error", "pending", "saving"].includes(description.status);
  const quiet = !pressing && !source && !busy;

  return (
    <section aria-label="Description" className="flex flex-col gap-2">
      <div
        className="group/description flex flex-col gap-2"
        onBlur={(event) => {
          if (
            event.currentTarget.contains(event.relatedTarget) ||
            document.querySelector(":active") === null
          ) {
            return;
          }

          setPressing(true);

          const release = () => {
            window.removeEventListener("pointerup", release);
            window.removeEventListener("pointercancel", release);
            setTimeout(() => {
              setPressing(false);
            }, 0);
          };

          window.addEventListener("pointerup", release);
          window.addEventListener("pointercancel", release);
        }}
      >
        <MarkdownField
          checkable={editable}
          className={cn(
            "text-prose focus-within:min-h-24",
            pressing && "min-h-24"
          )}
          draft={description.draft}
          editable={editable}
          label="Description"
          onChange={description.handleChange}
          placeholder="Add a description… Type / for blocks"
          ref={editor}
          source={source}
          uploadTo={`/issues/${issue.key}/attachments`}
          value={description.value}
        />
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Pressing a tool keeps focus in the description, so the footer that focus reveals stays open. */}
        <div
          className={cn(
            "flex min-h-6 items-center justify-end gap-3",
            quiet && "hidden group-focus-within/description:flex"
          )}
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) {
              event.preventDefault();
            }
          }}
        >
          <SaveState
            onRetry={description.handleFlush}
            status={description.status}
          />
          {editable ? (
            <>
              <AttachButton
                onFiles={(files) => {
                  editor.current?.upload(files);
                }}
              />
              <SourceToggle onChange={setSource} source={source} />
            </>
          ) : null}
        </div>
      </div>
      <ConflictDialog
        field="description"
        mine={description.value}
        onKeepMine={description.handleKeepMine}
        onUseTheirs={description.handleDiscard}
        saved={description.conflict}
      />
      {attachments ? (
        <div
          className="scroll-mt-4 outline-none empty:hidden"
          id={attachmentsId(issue)}
          tabIndex={-1}
        >
          <IssueAttachments compact editable={editable} issue={issue} />
        </div>
      ) : null}
    </section>
  );
};

const DeletedBanner = ({ onRestore }: { onRestore: () => void }) => (
  <Alert>
    <Trash2Icon />
    <AlertTitle>This issue is deleted</AlertTitle>
    <AlertDescription>Restore it to edit it again.</AlertDescription>
    <AlertAction>
      <Button onClick={onRestore} size="sm" variant="outline">
        <RotateCcwIcon data-icon="inline-start" />
        Restore
      </Button>
    </AlertAction>
  </Alert>
);

const LoadError = ({
  error,
  issueKey,
  onRetry,
}: {
  error: Error;
  issueKey: string;
  onRetry: () => void;
}) => (
  <Page title={issueKey}>
    {isNotFound(error) ? (
      <RouteNotFound />
    ) : (
      <LoadFailed
        className="m-4"
        error={error}
        onRetry={onRetry}
        title={`Could not load ${issueKey}`}
      />
    )}
  </Page>
);

const Neighbors = ({
  count,
  index,
  onGo,
}: {
  count: number;
  index: number;
  onGo: (step: -1 | 1) => void;
}) => (
  <>
    {index === -1 ? null : (
      <span className="text-muted-foreground mr-1 hidden text-xs tabular-nums sm:inline">
        {index + 1} / {count}
      </span>
    )}
    <Hint hotkey={{ keys: "k" }} label="Previous issue">
      <Button
        aria-keyshortcuts="K"
        aria-label="Previous issue"
        disabled={index <= 0}
        onClick={() => {
          onGo(-1);
        }}
        size="icon-sm"
        variant="ghost"
      >
        <ChevronUpIcon />
      </Button>
    </Hint>
    <Hint hotkey={{ keys: "j" }} label="Next issue">
      <Button
        aria-keyshortcuts="J"
        aria-label="Next issue"
        disabled={index === -1 || index >= count - 1}
        onClick={() => {
          onGo(1);
        }}
        size="icon-sm"
        variant="ghost"
      >
        <ChevronDownIcon />
      </Button>
    </Hint>
  </>
);

const IssueActions = ({
  branch,
  issue,
  onDelete,
  project,
  slug,
}: {
  branch: string;
  issue: Issue;
  onDelete: () => void;
  project?: string;
  slug: string;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button aria-label="Issue actions" size="icon-sm" variant="ghost" />
      }
    >
      <EllipsisIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64">
      {project === undefined ? null : (
        <>
          <DropdownMenuGroup>
            <DropdownMenuItem
              render={
                <Link
                  params={{ key: project, slug }}
                  search={{ issue: issue.key }}
                  to="/$slug/project/$key"
                />
              }
            >
              <PanelRightIcon />
              Show in project
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuGroup>
        <DropdownMenuItem
          onClick={() => {
            void copyText(issue.key, "issue ID");
          }}
        >
          <CopyIcon />
          Copy key
          <MenuKeys hotkey={{ keys: ".", mod: true }} />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void copyText(issueUrl(slug, issue.key), "issue link");
          }}
        >
          <LinkIcon />
          Copy link
          <MenuKeys hotkey={{ keys: ",", mod: true, shift: true }} />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void copyText(branch, "git branch name");
          }}
        >
          <GitBranchIcon />
          Copy git branch name
          <MenuKeys hotkey={{ keys: ".", mod: true, shift: true }} />
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {issue.deletedAt === null ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} variant="destructive">
            <Trash2Icon />
            Delete issue
            <MenuKeys hotkey={{ keys: "backspace", mod: true }} />
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
);

const CopyLink = ({ issueKey, slug }: { issueKey: string; slug: string }) => (
  <Hint label="Copy issue URL">
    <Button
      aria-label="Copy issue URL"
      className="max-md:hidden"
      onClick={() => {
        void copyText(issueUrl(slug, issueKey), "issue link");
      }}
      size="icon-sm"
      variant="ghost"
    >
      <LinkIcon />
    </Button>
  </Hint>
);

const useWide = () => {
  const [wide, setWide] = useState(false);

  const measure = useCallback((layout: HTMLDivElement | null) => {
    const observer = new ResizeObserver(([entry]) => {
      setWide((entry?.contentRect.width ?? 0) >= 820);
    });

    if (layout !== null) {
      setWide(layout.clientWidth >= 820);
      observer.observe(layout);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return { measure, wide };
};

const useIssueQuery = (project: ProjectDetail, issueKey: string) => {
  const queryClient = useQueryClient();

  return useQuery({
    ...issueQuery(project.id, issueKey),
    placeholderData: () => {
      const cached = findCachedIssue(queryClient, project.id, issueKey);

      return cached === undefined ? undefined : placeholderIssue(cached);
    },
  });
};

const prefetchKeys = (
  queryClient: QueryClient,
  keys: (string | undefined)[]
) => {
  for (const key of keys) {
    const issue = key === undefined ? null : findIssueByKey(queryClient, key);

    if (issue !== null) {
      void prefetchIssue(queryClient, issue);
    }
  }
};

const recentIssue = (slug: string, issue: Issue): RecentItem => ({
  href: issueHref(slug, issue.key),
  kind: "issue",
  label: issue.key,
  statusId: issue.statusId,
  title: issue.title,
});

const useOpenIssue = (
  slug: string,
  issue: Issue | undefined,
  active: boolean
) => {
  const deleted = issue !== undefined && issue.deletedAt !== null;
  const key = issue?.key;

  useContextIssue(issue, active);
  useEffect(() => {
    if (deleted && key !== undefined) {
      forgetRecentHrefs(slug, [issueHref(slug, key)]);
    }
  }, [deleted, key, slug]);
  useRememberRecent(
    slug,
    active && issue !== undefined && !deleted
      ? recentIssue(slug, issue)
      : undefined
  );
};

const IssueBody = ({
  data,
  placeholder,
  project,
}: {
  data: Issue | undefined;
  placeholder: boolean;
  project: ProjectDetail;
}) => {
  const updateIssue = useUpdateIssue();
  const deletion = useDeleteIssue();
  const description = useRef<MarkdownEditorHandle>(null);
  const { measure, wide } = useWide();
  const ready = data !== undefined && !placeholder;
  const editable = ready && data.deletedAt === null;

  const properties = (layout: "pills" | "rail") =>
    data === undefined ? null : (
      <IssueProperties
        issue={data}
        layout={layout}
        onChange={(patch) => {
          if (editable) {
            updateIssue(data, patch);
          }
        }}
        project={project}
      />
    );

  return (
    <div className="issue-layout pb-16" ref={measure}>
      <article className="flex min-w-0 flex-col gap-4 px-3.5 pt-2.5 md:pt-5.75 @min-[820px]:col-start-2">
        {ready && data.deletedAt !== null ? (
          <DeletedBanner
            onRestore={() => {
              void deletion.restore([data]);
            }}
          />
        ) : null}
        {ready ? (
          <Title
            editable={editable}
            issue={data}
            key={`title-${data.id}`}
            onDone={() => {
              description.current?.focus();
            }}
          />
        ) : (
          <h2 className="text-title">
            {data?.title ?? (
              <div aria-busy className="skeleton-delay">
                <Skeleton className="h-8 w-2/3" />
              </div>
            )}
          </h2>
        )}
        {wide ? null : (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1.5">
              {properties("pills")}
              {ready ? <AttachmentsChip issue={data} /> : null}
            </div>
            {ready ? <IssueDevelopment collapsible issue={data} /> : null}
          </div>
        )}
        {ready ? (
          <Description
            attachments={!wide}
            editable={editable}
            editor={description}
            issue={data}
            key={`description-${data.id}`}
          />
        ) : (
          <div aria-busy className="skeleton-delay flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {ready ? (
          <IssueTimeline editable={editable} issue={data} project={project} />
        ) : null}
      </article>
      {wide ? (
        <aside
          aria-label="Issue details"
          className="sticky top-4 col-start-3 flex flex-col gap-8 self-start px-1 pt-5.75"
        >
          {properties("rail")}
          {ready ? (
            <>
              <IssueDevelopment issue={data} />
              <IssueAttachments compact editable={editable} issue={data} />
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
};

const IssueScreen = ({
  issueKey,
  project,
}: {
  issueKey: string;
  project: ProjectDetail;
}) => {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const deletion = useDeleteIssue();
  const issue = useIssueQuery(project, issueKey);
  const { data } = issue;
  const ready = data !== undefined && !issue.isPlaceholderData;
  const neighbors = useNeighbors(project, issueKey, ready);
  const { origin } = neighbors;
  const back = useBack(origin);
  const username = useUsername();
  const full = useLocation({ select: (location) => location.state.full });
  const queryClient = useQueryClient();
  const { next, previous } = neighbors;

  useEffect(() => {
    prefetchKeys(queryClient, [issueKey, previous, next]);
  }, [issueKey, next, previous, queryClient]);

  const go = (key: string | undefined) => {
    if (key !== undefined) {
      void navigate({
        params: { issueKey: key, slug: workspace.slug },
        replace: true,
        state: { from: origin, full, walk: neighbors.keys },
        to: "/$slug/issue/$issueKey",
      });
    }
  };

  const editable = ready && data.deletedAt === null;
  const fits = usePanelFits();

  const remove = () => {
    if (editable) {
      void deletion.remove([data]);
      back();
    }
  };

  const step = (offset: -1 | 1) => {
    go(offset === 1 ? neighbors.next : neighbors.previous);
  };

  useHotkey("j", () => {
    step(1);
  });
  useHotkey("k", () => {
    step(-1);
  });
  useHotkey("escape", back);
  useOpenIssue(workspace.slug, data, editable);
  usePageTitle(data && `${data.key} ${data.title}`);
  useHotkey("backspace", remove, { mod: true });

  if (issue.isError && data === undefined) {
    return (
      <LoadError
        error={issue.error}
        issueKey={issueKey}
        onRetry={() => {
          void issue.refetch();
        }}
      />
    );
  }

  return (
    <Page
      actions={
        <>
          {ready ? <PresenceAvatars targetId={data.id} /> : null}
          <Neighbors
            count={neighbors.count}
            index={neighbors.index}
            onGo={step}
          />
          <CopyLink issueKey={issueKey} slug={workspace.slug} />
          {ready ? (
            <IssueActions
              branch={branchName(username, data.key, data.title)}
              issue={data}
              onDelete={remove}
              project={fits ? project.key : undefined}
              slug={workspace.slug}
            />
          ) : null}
        </>
      }
      className="@container"
      crumbs={[
        {
          label: workspace.name,
          link: (
            <Link params={{ slug: workspace.slug }} to="/$slug/my-issues" />
          ),
        },
        originCrumb(origin, project, workspace.slug),
      ]}
      title={issueKey}
    >
      <IssueBody
        data={data}
        placeholder={issue.isPlaceholderData}
        project={project}
      />
    </Page>
  );
};

const PanelError = ({
  error,
  issueKey,
  onRetry,
}: {
  error: Error;
  issueKey: string;
  onRetry: () => void;
}) => {
  if (isNotFound(error)) {
    return (
      <p className="text-muted-foreground p-4">
        {issueKey} does not exist or was deleted.
      </p>
    );
  }

  return (
    <LoadFailed
      className="m-4"
      error={error}
      onRetry={onRetry}
      title={`Could not load ${issueKey}`}
    />
  );
};

const PanelSteps = () => {
  const queryClient = useQueryClient();

  const step = (offset: -1 | 1) => {
    stepFromPanel(queryClient, offset);
  };

  return (
    <>
      <Hint hotkey={{ keys: "k" }} label="Previous issue">
        <Button
          aria-keyshortcuts="K"
          aria-label="Previous issue"
          onClick={() => {
            step(-1);
          }}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronUpIcon />
        </Button>
      </Hint>
      <Hint hotkey={{ keys: "j" }} label="Next issue">
        <Button
          aria-keyshortcuts="J"
          aria-label="Next issue"
          onClick={() => {
            step(1);
          }}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronDownIcon />
        </Button>
      </Hint>
    </>
  );
};

const PanelScreen = ({
  issueKey,
  origin,
  project,
}: {
  issueKey: string;
  origin: IssueOrigin | undefined;
  project: ProjectDetail;
}) => {
  const workspace = useWorkspace();
  const deletion = useDeleteIssue();
  const username = useUsername();
  const issue = useIssueQuery(project, issueKey);
  const { data } = issue;
  const ready = data !== undefined && !issue.isPlaceholderData;
  const editable = ready && data.deletedAt === null;
  const panel = usePanel();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const ids = rowOrder();
    const at = ids.indexOf(findIssueByKey(queryClient, issueKey)?.id ?? "");

    const nearby = (at === -1 ? [] : [ids[at - 1], ids[at + 1]]).map((id) =>
      id === undefined ? undefined : findIssue(queryClient, id)?.key
    );

    prefetchKeys(queryClient, [issueKey, ...nearby]);
  }, [issueKey, queryClient]);

  const fullPage = linkOptions({
    params: { issueKey, slug: workspace.slug },
    state: {
      from: origin === undefined ? undefined : { ...origin, panel: issueKey },
      full: true,
    },
    to: "/$slug/issue/$issueKey",
  });

  useOpenIssue(workspace.slug, data, editable && !panel.picked);
  useHotkey("o", () => {
    if (panelVisible(panel)) {
      void navigate(fullPage);
    }
  });

  return (
    <>
      <header className="flex h-11 shrink-0 items-center border-b pr-2 pl-4">
        <div className="flex w-full max-w-360 items-center gap-1">
          <h2 className="text-muted-foreground tracking-key min-w-0 flex-1 truncate font-medium">
            {issueKey}
            {data === undefined ? null : (
              <span className="sr-only"> {data.title}</span>
            )}
          </h2>
          {ready ? <PresenceAvatars targetId={data.id} /> : null}
          {origin === undefined ? null : <PanelSteps />}
          <Hint hotkey={{ keys: "o" }} label="Open full page">
            <Link
              aria-keyshortcuts="O"
              aria-label="Open full page"
              className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
              {...fullPage}
            >
              <Maximize2Icon />
            </Link>
          </Hint>
          {ready ? (
            <IssueActions
              branch={branchName(username, data.key, data.title)}
              issue={data}
              onDelete={() => {
                if (editable) {
                  void deletion.remove([data]);
                }
              }}
              slug={workspace.slug}
            />
          ) : null}
        </div>
      </header>
      <div className="pane-text @container min-h-0 flex-1 overflow-y-auto">
        {issue.isError && data === undefined ? (
          <PanelError
            error={issue.error}
            issueKey={issueKey}
            onRetry={() => {
              void issue.refetch();
            }}
          />
        ) : (
          <IssueBody
            data={data}
            placeholder={issue.isPlaceholderData}
            project={project}
          />
        )}
      </div>
    </>
  );
};

export const IssuePanelContent = ({
  issueKey,
  origin,
}: {
  issueKey: string;
  origin: IssueOrigin | undefined;
}) => {
  const workspace = useWorkspace();
  const project = useQuery(projectQuery(issueKey.split("-")[0] ?? ""));

  if (project.isError && project.data === undefined) {
    return (
      <PanelError
        error={project.error}
        issueKey={issueKey}
        onRetry={() => {
          void project.refetch();
        }}
      />
    );
  }

  if (project.data === undefined) {
    return (
      <div aria-busy className="skeleton-delay flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  if (project.data.workspaceSlug !== workspace.slug) {
    return (
      <p className="text-muted-foreground p-4">
        {issueKey} is in another workspace.{" "}
        <Link
          className="text-foreground underline underline-offset-4"
          params={{ issueKey, slug: project.data.workspaceSlug }}
          to="/$slug/issue/$issueKey"
        >
          Open it
        </Link>
      </p>
    );
  }

  return (
    <PanelScreen
      issueKey={issueKey}
      key={issueKey}
      origin={origin}
      project={project.data}
    />
  );
};

const SplitIssue = ({
  issueKey,
  project,
}: {
  issueKey: string;
  project: ProjectDetail;
}) => {
  const { slug } = useWorkspace();
  const origin = useOrigin(project);

  if (origin.view === "mine") {
    return (
      <Navigate
        params={{ slug }}
        replace
        search={{ ...origin.search, issue: issueKey }}
        to="/$slug/my-issues"
      />
    );
  }

  return (
    <Navigate
      params={{ key: origin.projectKey, slug }}
      replace
      search={{ ...origin.search, issue: issueKey }}
      to="/$slug/project/$key"
    />
  );
};

export const IssueDetail = ({ issueKey }: { issueKey: string }) => {
  const workspace = useWorkspace();
  const workspaces = useMe().data?.workspaces;
  const key = issueKey.toUpperCase();
  const project = useQuery(projectQuery(key.split("-")[0] ?? ""));
  const full = useLocation({ select: (location) => location.state.full });
  const entry = useLocation({ select: (location) => location.state.__TSR_key });
  const wide = useWideEntry(entry);
  const panelOpen = usePanelOpen();

  if (project.isError && project.data === undefined) {
    return (
      <LoadError
        error={project.error}
        issueKey={key}
        onRetry={() => {
          void project.refetch();
        }}
      />
    );
  }

  if (project.data === undefined) {
    return (
      <Page title={key}>
        <div aria-busy className="skeleton-delay flex flex-col gap-3 p-8">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-full" />
        </div>
      </Page>
    );
  }

  const owner = workspaces?.find(
    (item) => item.slug === project.data.workspaceSlug
  );

  if (owner !== undefined && owner.id !== workspace.id) {
    return (
      <Navigate
        params={{ issueKey: key, slug: project.data.workspaceSlug }}
        replace
        to="/$slug/issue/$issueKey"
      />
    );
  }

  if (wide && panelOpen && full !== true) {
    return <SplitIssue issueKey={key} project={project.data} />;
  }

  return (
    <IssueScreen issueKey={key} key={project.data.id} project={project.data} />
  );
};

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import {
  Link,
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
  PanelRightIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { AttachButton } from "~/components/attach-button";
import { ConflictDialog, SaveState } from "~/components/conflict-dialog";
import { IssueAttachments } from "~/components/issue-attachments";
import { IssueDevelopment } from "~/components/issue-development";
import { Hint } from "~/components/issue-parts";
import { IssueProperties } from "~/components/issue-properties";
import { IssueTimeline } from "~/components/issue-timeline";
import { LoadFailed } from "~/components/load-failed";
import { MarkdownEditor, SourceToggle } from "~/components/markdown-editor";
import type { MarkdownEditorHandle } from "~/components/markdown-editor";
import { MenuKeys } from "~/components/menu-filter";
import { Page } from "~/components/page";
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
import { useMediaQuery } from "~/hooks/use-media-query";
import { isNotFound, useMe, useUsername } from "~/lib/api";
import type { Issue, IssueSummary, ProjectDetail } from "~/lib/api-types";
import { branchName } from "~/lib/branch";
import { copyText, issueUrl } from "~/lib/copy";
import { useDeleteIssue } from "~/lib/issue-actions";
import { moveFocus, useContextIssue } from "~/lib/issue-focus";
import {
  focusPanelRow,
  followFocus,
  splitQuery,
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
  issuesQuery,
  projectQuery,
} from "~/lib/queries";
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

const useNeighbors = (project: ProjectDetail, key: string) => {
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const origin = useOrigin(project);
  const mine = origin.view === "mine";
  const search = mine ? {} : origin.search;
  const open = useQuery(issuesQuery(project)).data ?? [];
  const assigned = useMyIssues(workspace.slug, mine);

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
      ? assigned.issues
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
    previous: index > 0 ? keys[index - 1] : undefined,
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
        link: (
          <Link
            params={{ slug }}
            search={{ issue: origin.panel }}
            to="/$slug/my-issues"
          />
        ),
      }
    : {
        label:
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
        search: { issue: origin.panel },
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

const ChecklistProgress = ({ issue }: { issue: Issue }) => {
  if (issue.checklistTotal === 0) {
    return null;
  }

  return (
    <span className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
      <progress
        aria-label="Checklist progress"
        className="bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary h-1 w-16 appearance-none overflow-hidden rounded-full"
        max={issue.checklistTotal}
        value={issue.checklistDone}
      />
      {issue.checklistDone}/{issue.checklistTotal}
    </span>
  );
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

const Description = ({
  sections,
  editable,
  editor,
  issue,
}: {
  sections: boolean;
  editable: boolean;
  editor: RefObject<MarkdownEditorHandle | null>;
  issue: Issue;
}) => {
  const description = useIssueDraft(issue, "description", 600);
  const [source, setSource] = useState(false);

  return (
    <section aria-label="Description" className="flex flex-col gap-2">
      <MarkdownEditor
        checkable={editable}
        className={cn(
          "text-prose",
          description.value === "" ? "min-h-24" : "focus-within:min-h-24"
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
      <div className="flex min-h-6 items-center gap-3">
        <ChecklistProgress issue={issue} />
        <span className="ml-auto" />
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
      <ConflictDialog
        field="description"
        mine={description.value}
        onKeepMine={description.handleKeepMine}
        onUseTheirs={description.handleDiscard}
        saved={description.conflict}
      />
      {sections ? (
        <>
          <IssueDevelopment issue={issue} />
          <IssueAttachments editable={editable} issue={issue} />
        </>
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
    <DropdownMenuContent align="end" className="w-60">
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

const Toolbar = ({
  branch,
  issue,
  slug,
}: {
  branch: string;
  issue: Issue;
  slug: string;
}) => (
  <div className="@min-[820px]:sticky @min-[820px]:top-0 @min-[820px]:z-10 @min-[820px]:h-0">
    <div className="flex justify-end gap-1.5 px-3 pt-2 @min-[820px]:pt-1.5">
      {[
        {
          icon: LinkIcon,
          label: "Copy issue URL",
          run: async () => {
            await copyText(issueUrl(slug, issue.key), "issue link");
          },
        },
        {
          icon: CopyIcon,
          label: "Copy issue ID",
          run: async () => {
            await copyText(issue.key, "issue ID");
          },
        },
        {
          icon: GitBranchIcon,
          label: "Copy git branch name",
          run: async () => {
            await copyText(branch, "git branch name");
          },
        },
      ].map(({ icon: Icon, label, run }) => (
        <Hint key={label} label={label}>
          <Button
            aria-label={label}
            onClick={() => {
              void run();
            }}
            size="icon-round"
            variant="outline"
          >
            <Icon />
          </Button>
        </Hint>
      ))}
    </div>
  </div>
);

const useWide = (layout: RefObject<HTMLDivElement | null>, shown: boolean) => {
  const [wide, setWide] = useState(false);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setWide((entry?.contentRect.width ?? 0) >= 820);
    });

    if (shown && layout.current !== null) {
      observer.observe(layout.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [layout, shown]);

  return wide;
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

const IssueBody = ({
  data,
  placeholder,
  project,
  toolbar,
}: {
  data: Issue | undefined;
  placeholder: boolean;
  project: ProjectDetail;
  toolbar: boolean;
}) => {
  const workspace = useWorkspace();
  const updateIssue = useUpdateIssue();
  const deletion = useDeleteIssue();
  const username = useUsername();
  const description = useRef<MarkdownEditorHandle>(null);
  const columns = useRef<HTMLDivElement>(null);
  const wide = useWide(columns, true);
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
    <>
      {ready && toolbar ? (
        <Toolbar
          branch={branchName(username, data.key, data.title)}
          issue={data}
          slug={workspace.slug}
        />
      ) : null}
      <div className="issue-layout pb-16" ref={columns}>
        <article
          className={cn(
            "flex min-w-0 flex-col gap-4 px-3.5 pt-2.5 md:pt-5.75 @min-[820px]:col-start-2",
            toolbar && "@min-[820px]:pt-14.75"
          )}
        >
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
              {data?.title ?? <Skeleton className="h-8 w-2/3" />}
            </h2>
          )}
          {wide ? null : (
            <div className="flex flex-wrap gap-1.5">{properties("pills")}</div>
          )}
          {ready ? (
            <Description
              sections={!wide}
              editable={editable}
              editor={description}
              issue={data}
              key={`description-${data.id}`}
            />
          ) : (
            <div aria-busy className="flex flex-col gap-2">
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
            className={cn(
              "sticky top-0 col-start-3 flex flex-col gap-8 self-start px-1",
              toolbar ? "pt-18.75" : "pt-5.75"
            )}
          >
            {properties("rail")}
            {ready ? (
              <>
                <IssueDevelopment issue={data} />
                <IssueAttachments editable={editable} issue={data} />
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </>
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
  const neighbors = useNeighbors(project, issueKey);
  const issue = useIssueQuery(project, issueKey);
  const { origin } = neighbors;
  const back = useBack(origin);
  const username = useUsername();
  const full = useLocation({ select: (location) => location.state.full });

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

  const { data } = issue;
  const ready = data !== undefined && !issue.isPlaceholderData;
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
  useContextIssue(data, editable);
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
          <Neighbors
            count={neighbors.count}
            index={neighbors.index}
            onGo={step}
          />
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
      crumbs={[originCrumb(origin, project, workspace.slug)]}
      title={data === undefined ? issueKey : `${issueKey} ${data.title}`}
    >
      <IssueBody
        data={data}
        placeholder={issue.isPlaceholderData}
        project={project}
        toolbar
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
    focusPanelRow(queryClient);
    moveFocus(offset);
    followFocus(queryClient);
  };

  return (
    <>
      <Hint label="Previous issue">
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
      <Hint label="Next issue">
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
  const { picked } = usePanel();

  useContextIssue(data, editable && !picked);

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-2 pl-4">
        <h2 className="text-muted-foreground tracking-key min-w-0 flex-1 truncate font-medium">
          {issueKey}
          {data === undefined ? null : (
            <span className="sr-only"> {data.title}</span>
          )}
        </h2>
        {origin === undefined ? null : <PanelSteps />}
        <Hint label="Open full page">
          <Link
            aria-label="Open full page"
            className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
            params={{ issueKey, slug: workspace.slug }}
            state={{
              from:
                origin === undefined
                  ? undefined
                  : { ...origin, panel: issueKey },
              full: true,
            }}
            to="/$slug/issue/$issueKey"
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
          <div className="max-w-7xl">
            <IssueBody
              data={data}
              placeholder={issue.isPlaceholderData}
              project={project}
              toolbar={false}
            />
          </div>
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
      <div aria-busy className="flex flex-col gap-3 p-4">
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
        search={{ issue: issueKey }}
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
  const wide = useMediaQuery(splitQuery);
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
        <div aria-busy className="flex flex-col gap-3 p-8">
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

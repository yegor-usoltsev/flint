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
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { ConflictDialog, SaveState } from "~/components/conflict-dialog";
import { IssueAttachments } from "~/components/issue-attachments";
import { IssueDevelopment } from "~/components/issue-development";
import { Hint } from "~/components/issue-parts";
import { IssueProperties } from "~/components/issue-properties";
import { IssueTimeline } from "~/components/issue-timeline";
import { LoadFailed } from "~/components/load-failed";
import {
  AttachButton,
  MarkdownEditor,
  SourceToggle,
} from "~/components/markdown-editor";
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
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Skeleton } from "~/components/ui/skeleton";
import { isNotFound, useMe, useUsername } from "~/lib/api";
import type { Issue, IssueSummary, ProjectDetail } from "~/lib/api-types";
import { branchName } from "~/lib/branch";
import { copyText, issueUrl } from "~/lib/copy";
import { useDeleteIssue } from "~/lib/issue-actions";
import { useContextIssue } from "~/lib/issue-focus";
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

  if (from?.view === "mine" || from?.projectKey === project.key) {
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
        link: <Link params={{ slug }} to="/$slug/my-issues" />,
      }
    : {
        label: project.name,
        link: (
          <Link
            params={{ key: project.key, slug }}
            search={origin.search}
            to="/$slug/project/$key"
          />
        ),
      };

const useBack = (origin: IssueOrigin, project: ProjectDetail) => {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const { slug } = workspace;

  return () => {
    if (origin.view === "mine") {
      void navigate({ params: { slug }, to: "/$slug/my-issues" });
    } else {
      void navigate({
        params: { key: project.key, slug },
        search: origin.search,
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
  slug,
}: {
  branch: string;
  issue: Issue;
  onDelete: () => void;
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

const IssueScreen = ({
  issueKey,
  project,
}: {
  issueKey: string;
  project: ProjectDetail;
}) => {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const updateIssue = useUpdateIssue();
  const deletion = useDeleteIssue();
  const neighbors = useNeighbors(project, issueKey);
  const description = useRef<MarkdownEditorHandle>(null);
  const columns = useRef<HTMLDivElement>(null);

  const issue = useQuery({
    ...issueQuery(project.id, issueKey),
    placeholderData: () => {
      const cached = findCachedIssue(queryClient, project.id, issueKey);

      return cached === undefined ? undefined : placeholderIssue(cached);
    },
  });

  const { origin } = neighbors;
  const back = useBack(origin, project);
  const username = useUsername();

  const go = (key: string | undefined) => {
    if (key !== undefined) {
      void navigate({
        params: { issueKey: key, slug: workspace.slug },
        replace: true,
        state: { from: origin, walk: neighbors.keys },
        to: "/$slug/issue/$issueKey",
      });
    }
  };

  const { data } = issue;
  const ready = data !== undefined && !issue.isPlaceholderData;
  const editable = ready && data.deletedAt === null;
  const failed = issue.isError && data === undefined;
  const wide = useWide(columns, !failed);

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

  if (failed) {
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
              slug={workspace.slug}
            />
          ) : null}
        </>
      }
      className="@container"
      crumbs={[originCrumb(origin, project, workspace.slug)]}
      title={data === undefined ? issueKey : `${issueKey} ${data.title}`}
    >
      {ready ? (
        <Toolbar
          branch={branchName(username, data.key, data.title)}
          issue={data}
          slug={workspace.slug}
        />
      ) : null}
      <div className="issue-layout pb-16" ref={columns}>
        <article className="flex min-w-0 flex-col gap-4 px-3.5 pt-2.5 md:pt-5.75 @min-[820px]:col-start-2 @min-[820px]:pt-14.75">
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
            className="sticky top-0 col-start-3 flex flex-col gap-8 self-start px-1 pt-18.75"
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
    </Page>
  );
};

export const IssueDetail = ({ issueKey }: { issueKey: string }) => {
  const workspace = useWorkspace();
  const workspaces = useMe().data?.workspaces;
  const key = issueKey.toUpperCase();
  const project = useQuery(projectQuery(key.split("-")[0] ?? ""));

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

  return (
    <IssueScreen issueKey={key} key={project.data.id} project={project.data} />
  );
};

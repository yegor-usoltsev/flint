import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  BookOpenIcon,
  CircleDotIcon,
  FolderPlusIcon,
  ListFilterIcon,
  PlusIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";

import { useCreateIssue } from "~/components/create-issue";
import { FilterChips, useMineFilterOptions } from "~/components/issue-filters";
import type { ChangeFilter } from "~/components/issue-filters";
import { IssueListActions } from "~/components/issue-list-actions";
import type { IssueLookup } from "~/components/issue-parts";
import { IssueLayout } from "~/components/issues-view";
import type { OpenIssue } from "~/components/issues-view";
import { NavSwitcher } from "~/components/nav-switcher";
import { Page } from "~/components/page";
import { ProjectDialog } from "~/components/project-dialog";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { useMe } from "~/lib/api";
import type { IssueSummary, Status } from "~/lib/api-types";
import { showInPanel } from "~/lib/issue-panel";
import { useSelectionScope } from "~/lib/issue-selection";
import {
  isClosedStatus,
  isFiltered,
  mineFilterKeys,
  MineSearchSchema,
  mineViewKey,
  useProjectView,
  withKnown,
  withKnownLabels,
} from "~/lib/issue-view";
import type { MineSearch, ViewKind } from "~/lib/issue-view";
import {
  createTarget,
  mineStatuses,
  useMineSearchUpdates,
  useMyIssues,
} from "~/lib/my-issues";
import { loadMyIssues, preload } from "~/lib/preload";
import {
  issueQuery,
  labelsQuery,
  membersQuery,
  projectsQuery,
} from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useUpdateIssue } from "~/lib/use-update-issue";
import { useWorkspace } from "~/lib/use-workspace";

const NoProjects = ({ isAdmin, slug }: { isAdmin: boolean; slug: string }) => {
  const [creating, setCreating] = useState(false);

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderPlusIcon />
        </EmptyMedia>
        <EmptyTitle>
          <h2>No projects yet</h2>
        </EmptyTitle>
        <EmptyDescription>
          {isAdmin
            ? "Create a project to start tracking issues."
            : "A workspace admin creates projects. Ask one to set up the first project."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {isAdmin ? (
          <>
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <PlusIcon data-icon="inline-start" />
              Create project
            </Button>
            <ProjectDialog
              onOpenChange={setCreating}
              open={creating}
              slug={slug}
            />
          </>
        ) : null}
        <div className="flex flex-wrap justify-center gap-1">
          {isAdmin ? (
            <Link
              className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
              params={{ slug }}
              to="/$slug/settings/members"
            >
              <UsersIcon data-icon="inline-start" />
              Invite members
            </Link>
          ) : null}
          <Link
            className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
            params={{ _splat: "", slug }}
            to="/$slug/wiki/$"
          >
            <BookOpenIcon data-icon="inline-start" />
            Open the wiki
          </Link>
        </div>
      </EmptyContent>
    </Empty>
  );
};

const LoadFailed = ({
  onRetry,
  partial,
}: {
  onRetry: () => void;
  partial: boolean;
}) => (
  <Alert className="m-4 w-auto" variant="destructive">
    <TriangleAlertIcon />
    <AlertTitle>
      <h2>
        {partial ? "Some projects could not load" : "Issues could not load"}
      </h2>
    </AlertTitle>
    <AlertDescription>
      {partial
        ? "Issues from those projects are missing below."
        : "Your assigned issues are unavailable."}
      <Button onClick={onRetry} size="sm" variant="outline">
        Retry
      </Button>
    </AlertDescription>
  </Alert>
);

const NothingAssigned = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <CircleDotIcon />
      </EmptyMedia>
      <EmptyTitle>
        <h2>Nothing assigned to you</h2>
      </EmptyTitle>
      <EmptyDescription>
        Issues assigned to you across the workspace show up here. Press I on a
        focused issue to take it.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const NoMatches = ({ onClear }: { onClear: () => void }) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <ListFilterIcon />
      </EmptyMedia>
      <EmptyTitle>
        <h2>No issues match these filters</h2>
      </EmptyTitle>
      <EmptyDescription>
        Change or clear the filters to see more issues.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button onClick={onClear} size="sm" variant="outline">
        Clear filters
      </Button>
    </EmptyContent>
  </Empty>
);

const orders = [
  { label: "Priority", value: "priority" },
  { label: "Last updated", value: "updated" },
] as const;

const AssignedIssues = ({
  onClear,
  search,
  slug,
  view,
}: {
  onClear: () => void;
  search: MineSearch;
  slug: string;
  view: ViewKind;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue();
  const mine = useMyIssues(slug, search);
  const members = useQuery(membersQuery(slug));
  const labels = useQuery(labelsQuery(slug));

  const {
    closed,
    columns,
    projects,
    retry: handleRetry,
    shown,
    statuses,
    visible,
  } = mine;

  useSelectionScope(mine.ordered.map((issue) => issue.id));

  if (mine.pending) {
    return (
      <div aria-busy className="flex flex-col gap-2 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  const failed = mine.failed ? (
    <LoadFailed onRetry={handleRetry} partial={mine.total > 0} />
  ) : null;

  if (
    visible.length === 0 &&
    (mine.total === 0 || !isFiltered(search, mineFilterKeys))
  ) {
    return failed ?? <NothingAssigned />;
  }

  const older =
    search.closed === true && closed.hasNextPage ? (
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
    ) : null;

  if (visible.length === 0) {
    return (
      <>
        {failed}
        <NoMatches onClear={onClear} />
        <div className="flex justify-center">{older}</div>
      </>
    );
  }

  const lookup: IssueLookup = {
    labels: new Map(labels.data?.map((label) => [label.id, label])),
    members: new Map(
      members.data?.flatMap((member) =>
        member.userId === null ? [] : [[member.userId, member]]
      )
    ),
    statuses,
  };

  const byId = new Map(visible.map((issue) => [issue.id, issue]));
  const projectOf = new Map(projects.map((project) => [project.id, project]));
  const groupName = new Map(shown.map((status) => [status.id, status.name]));
  const lastClosed = shown.findLast(isClosedStatus)?.id;

  const targetStatus = (issue: IssueSummary, groupId: string) =>
    projectOf
      .get(issue.projectId)
      ?.statuses.find((status) => status.name === groupName.get(groupId));

  const footer = (status: Status) => (status.id === lastClosed ? older : null);

  const onOpen: OpenIssue = (issue, how) => {
    if (issue.version === 0) {
      return;
    }

    if (how === "prefetch") {
      queryClient
        .query(issueQuery(issue.projectId, issue.key))
        .catch(() => null);
    } else if (how === "tab") {
      window.open(`/${slug}/issue/${issue.key}`, "_blank");
    } else if (!showInPanel(issue.key)) {
      void navigate({
        params: { issueKey: issue.key, slug },
        state: { from: { search, view: "mine" } },
        to: "/$slug/issue/$issueKey",
      });
    }
  };

  return (
    <>
      {failed}
      <IssueLayout
        accepts={(issue, groupId) => targetStatus(issue, groupId) !== undefined}
        assignee={false}
        columns={columns}
        footer={footer}
        issues={byId}
        lookup={lookup}
        manualIn={() => false}
        onCreate={(status) => {
          createIssue(createTarget(projects, status.name, search.project));
        }}
        onMove={(issue, to) => {
          const status = targetStatus(issue, to.statusId);

          if (status !== undefined && status.id !== issue.statusId) {
            updateIssue(issue, { statusId: status.id });
          }
        }}
        onOpen={onOpen}
        statuses={shown}
        total={(_status, loaded) => loaded}
        view={view}
      />
    </>
  );
};

const MineActions = ({
  onFilter,
  search,
  setSearch,
  slug,
  view,
}: {
  onFilter: ChangeFilter;
  search: MineSearch;
  setSearch: (patch: MineSearch) => void;
  slug: string;
  view: ViewKind;
}) => {
  const projects = useQuery(projectsQuery(slug)).data ?? [];
  const { projects: details } = useMyIssues(slug);

  return (
    <IssueListActions
      closed={search.closed === true}
      filter={{
        keys: mineFilterKeys,
        onChange: onFilter,
        options: useMineFilterOptions(mineStatuses(details), projects),
        values: search,
      }}
      onClosed={(all) => {
        setSearch({ closed: all ? true : undefined });
      }}
      onOrder={(order) => {
        setSearch({ order: order === "priority" ? undefined : order });
      }}
      order={search.order ?? "priority"}
      orders={orders}
      view={view}
      viewKey={mineViewKey}
    />
  );
};

const MineFilterChips = ({
  onChange,
  onClear,
  search,
  slug,
}: {
  onChange: ChangeFilter;
  onClear: () => void;
  search: MineSearch;
  slug: string;
}) => {
  const projects = useQuery(projectsQuery(slug)).data ?? [];
  const { projects: details } = useMyIssues(slug);

  return (
    <FilterChips
      keys={mineFilterKeys}
      onChange={onChange}
      onClear={onClear}
      options={useMineFilterOptions(mineStatuses(details), projects)}
      values={search}
    />
  );
};

const MyIssues = () => {
  const workspace = useWorkspace();
  const meId = useMe().data?.id;
  const projects = useQuery(projectsQuery(workspace.slug));
  const labels = useQuery(labelsQuery(workspace.slug)).data;
  const view = useProjectView(mineViewKey);

  const mine = useMyIssues(workspace.slug);

  const search = withKnown(
    withKnown(
      withKnownLabels(
        Route.useSearch({
          select: ({ issue: _shown, ...filters }) => filters,
          structuralSharing: true,
        }),
        labels
      ),
      "project",
      projects.data?.map((project) => project.key)
    ),
    "status",
    mine.pending || mine.failed
      ? undefined
      : mineStatuses(mine.projects).map((status) => status.name)
  );

  const { clearFilters, setSearch } = useMineSearchUpdates();

  const onFilter: ChangeFilter = (key, values) => {
    setSearch({ [key]: values.length === 0 ? undefined : values });
  };

  const ready =
    projects.data !== undefined &&
    projects.data.length > 0 &&
    meId !== undefined;

  return (
    <Page
      className={cn("flex flex-col", view === "board" && "overflow-hidden")}
      crumbs={[
        {
          label: workspace.name,
          link: (
            <Link params={{ slug: workspace.slug }} to="/$slug/my-issues" />
          ),
          short: workspace.name,
        },
      ]}
      actions={
        ready ? (
          <MineActions
            onFilter={onFilter}
            search={search}
            setSearch={setSearch}
            slug={workspace.slug}
            view={view}
          />
        ) : undefined
      }
      switcher={<NavSwitcher place={{ kind: "mine" }} />}
      title="My issues"
    >
      {projects.isPending ? (
        <div aria-busy className="flex flex-col gap-2 p-4">
          <Skeleton className="h-9 w-full" />
        </div>
      ) : null}
      {projects.data?.length === 0 ? (
        <NoProjects
          isAdmin={workspace.role === "admin"}
          slug={workspace.slug}
        />
      ) : null}
      {projects.isError ? (
        <LoadFailed
          onRetry={() => {
            void projects.refetch();
          }}
          partial={false}
        />
      ) : null}
      {ready ? (
        <>
          {isFiltered(search, mineFilterKeys) ? (
            <MineFilterChips
              onChange={onFilter}
              onClear={clearFilters}
              search={search}
              slug={workspace.slug}
            />
          ) : null}
          <div
            className={cn(
              "min-h-0 flex-1",
              view === "list" ? "overflow-y-auto" : "flex flex-col"
            )}
          >
            <AssignedIssues
              onClear={clearFilters}
              search={search}
              slug={workspace.slug}
              view={view}
            />
          </div>
        </>
      ) : null}
    </Page>
  );
};

export const Route = createFileRoute("/$slug/my-issues")({
  validateSearch: MineSearchSchema,
  component: MyIssues,
  loader: async ({ context, params }) => {
    await preload(async () => {
      await loadMyIssues(context.queryClient, params.slug);
    });
  },
  head: () => pageHead("My issues"),
});

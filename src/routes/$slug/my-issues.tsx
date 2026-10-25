import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  BookOpenIcon,
  CircleDotIcon,
  FolderPlusIcon,
  PlusIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";

import { IssueContextMenu } from "~/components/issue-menu";
import type { IssueLookup } from "~/components/issue-parts";
import { listClass, RowContent, rowClass } from "~/components/issues-view";
import { Page } from "~/components/page";
import { ProjectDialog } from "~/components/project-dialog";
import { StatusIcon } from "~/components/status-icon";
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
import type { IssueSummary } from "~/lib/api-types";
import { selectByClick } from "~/lib/issue-focus";
import { useSelected, useSelectionScope } from "~/lib/issue-selection";
import { useMyIssues } from "~/lib/my-issues";
import { loadMyIssues, preload } from "~/lib/preload";
import { labelsQuery, membersQuery, projectsQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
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

const IssueRow = ({
  issue,
  lookup,
  slug,
}: {
  issue: IssueSummary;
  lookup: IssueLookup;
  slug: string;
}) => {
  const selected = useSelected(issue.id);

  return (
    <Link
      className={rowClass}
      data-issue={issue.id}
      data-selected={selected ? "true" : undefined}
      onClick={(event) => {
        selectByClick(event, issue.id);
      }}
      params={{ issueKey: issue.key, slug }}
      state={{ from: { view: "mine" } }}
      to="/$slug/issue/$issueKey"
    >
      {selected ? <span className="sr-only">Selected,</span> : null}
      <RowContent issue={issue} lookup={lookup} />
    </Link>
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

const AssignedIssues = ({ slug }: { slug: string }) => {
  const { failed, groups, pending, retry, statuses } = useMyIssues(slug);
  const members = useQuery(membersQuery(slug));
  const labels = useQuery(labelsQuery(slug));

  useSelectionScope(
    groups.flatMap(({ issues }) => issues.map((issue) => issue.id))
  );

  if (pending) {
    return (
      <div aria-busy className="flex flex-col gap-2 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
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

  return (
    <IssueContextMenu>
      <div className={listClass}>
        {failed ? (
          <LoadFailed onRetry={retry} partial={groups.length > 0} />
        ) : null}
        {groups.length === 0 && !failed ? <NothingAssigned /> : null}
        {groups.map(({ issues, status }) => (
          <section aria-labelledby={`group-${status.id}`} key={status.name}>
            <h2
              className="bg-group-header sticky top-0 z-10 flex h-9 items-center gap-2 rounded-md px-2 font-medium"
              id={`group-${status.id}`}
            >
              <StatusIcon category={status.category} color={status.color} />
              {status.name}
              <span className="text-muted-foreground font-normal tabular-nums">
                {issues.length}
              </span>
            </h2>
            {issues.map((issue) => (
              <IssueRow
                issue={issue}
                key={issue.id}
                lookup={lookup}
                slug={slug}
              />
            ))}
          </section>
        ))}
      </div>
    </IssueContextMenu>
  );
};

const MyIssues = () => {
  const workspace = useWorkspace();
  const meId = useMe().data?.id;
  const projects = useQuery(projectsQuery(workspace.slug));

  return (
    <Page
      className="flex flex-col"
      crumbs={[
        {
          label: workspace.name,
          link: (
            <Link params={{ slug: workspace.slug }} to="/$slug/my-issues" />
          ),
          short: workspace.name,
        },
      ]}
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
      {projects.data !== undefined &&
      projects.data.length > 0 &&
      meId !== undefined ? (
        <AssignedIssues slug={workspace.slug} />
      ) : null}
    </Page>
  );
};

export const Route = createFileRoute("/$slug/my-issues")({
  component: MyIssues,
  loader: async ({ context, params }) => {
    await preload(async () => {
      await loadMyIssues(context.queryClient, params.slug);
    });
  },
  head: () => pageHead("My issues"),
});

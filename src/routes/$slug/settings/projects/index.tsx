import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useRef, useState } from "react";

import { LoadFailed } from "~/components/load-failed";
import { ProjectDialog } from "~/components/project-dialog";
import { ProjectIcon } from "~/components/project-icon";
import {
  SettingsFilter,
  SettingsPage,
  TableEmpty,
  tableDate,
  tableHead,
  tableNumber,
  tableRow,
} from "~/components/settings-page";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { formatDate } from "~/lib/issue-view";
import { projectsQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const Projects = () => {
  const workspace = useWorkspace();
  const projects = useQuery(projectsQuery(workspace.slug));
  const [creating, setCreating] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState("");
  const isAdmin = workspace.role === "admin";
  const words = filter.trim().toLowerCase();

  const shown = projects.data?.filter(
    (project) =>
      project.name.toLowerCase().includes(words) ||
      project.key.toLowerCase().includes(words)
  );

  const createButton = isAdmin ? (
    <Button
      onClick={() => {
        setCreating(true);
      }}
      ref={opener}
      size="pill"
    >
      Create project
    </Button>
  ) : undefined;

  return (
    <SettingsPage
      actions={
        isAdmin ? (
          <>
            {createButton}
            <ProjectDialog
              onOpenChange={setCreating}
              open={creating}
              opener={opener}
              slug={workspace.slug}
            />
          </>
        ) : null
      }
      description="Each project has its own key, issues and board. Keys never change."
      title="Projects"
      wide
    >
      <div className="flex flex-col gap-2">
        {projects.data?.length === 0 ? null : (
          <SettingsFilter
            label="Filter by name or key"
            onChange={setFilter}
            value={filter}
          />
        )}
        <div>
          {projects.data?.length === 0 ? null : (
            <div aria-hidden className={tableHead}>
              <span className="flex-1 pl-6">Name</span>
              <span className={tableNumber}>Open issues</span>
              <span className={tableDate}>Created</span>
              <span className="w-4" />
            </div>
          )}
          {projects.isPending ? <Skeleton className="h-11 w-full" /> : null}
          {projects.isError && projects.data === undefined ? (
            <LoadFailed
              error={projects.error}
              onRetry={() => {
                void projects.refetch();
              }}
              title="Projects could not load"
            />
          ) : null}
          {shown?.length === 0 ? (
            <TableEmpty
              action={createButton}
              description="Create a project to start tracking issues."
              filter={filter.trim()}
              onClearFilter={() => {
                setFilter("");
              }}
              title="No projects yet"
            />
          ) : null}
          <ul aria-label="Projects">
            {shown?.map((project) => (
              <li key={project.id}>
                <Link
                  className={tableRow}
                  params={{ key: project.key, slug: workspace.slug }}
                  to="/$slug/settings/projects/$key"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <ProjectIcon color={project.color} icon={project.icon} />
                    <span className="truncate font-medium">{project.name}</span>
                    <span className="text-muted-foreground tracking-key">
                      {project.key}
                    </span>
                  </span>
                  <span className={tableNumber}>
                    {project.openIssues}
                    <span className="sr-only"> open issues</span>
                  </span>
                  <span className={tableDate}>
                    <span className="sr-only">Created </span>
                    {formatDate(project.createdAt)}
                  </span>
                  <ChevronRightIcon
                    aria-hidden
                    className="text-muted-foreground size-4 shrink-0"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/projects/")({
  component: Projects,
  head: () => pageHead("Projects"),
});

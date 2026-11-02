import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
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
import {
  DragHandle,
  SortableList,
  useReorderProjects,
  useSortableItem,
} from "~/components/sortable-list";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import type { ProjectSummary } from "~/lib/api-types";
import { formatDate } from "~/lib/issue-view";
import { projectsQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const ProjectRow = ({
  index,
  moving,
  project,
  sortable,
  sorting,
}: {
  index: number;
  moving: boolean;
  project: ProjectSummary;
  sortable: boolean;
  sorting: boolean;
}) => {
  const workspace = useWorkspace();

  const { handleRef, isDragSource, ref } = useSortableItem({
    disabled: !(sortable && sorting) || moving,
    group: "projects",
    id: project.id,
    index,
  });

  return (
    <li
      className="group/sortable data-dragging:bg-popover data-dragging:shadow-raised relative rounded-md data-dragging:z-10"
      data-dragging={isDragSource ? "" : undefined}
      ref={ref}
    >
      {sortable && sorting ? (
        <DragHandle handleRef={handleRef} label={`Move ${project.name}`} />
      ) : null}
      <Link
        className={cn(tableRow, sortable && "pl-8 pointer-coarse:pl-2")}
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
  );
};

const Projects = () => {
  const workspace = useWorkspace();
  const projects = useQuery(projectsQuery(workspace.slug));
  const [creating, setCreating] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState("");
  const isAdmin = workspace.role === "admin";
  const words = filter.trim().toLowerCase();
  const sortable = isAdmin;
  const reorder = useReorderProjects(workspace.slug);

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
              <span
                className={cn(
                  "flex-1",
                  sortable ? "pl-12 pointer-coarse:pl-6" : "pl-6"
                )}
              >
                Name
              </span>
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
          <SortableList
            onMove={(id, index) => {
              reorder.move(projects.data ?? [], id, index);
            }}
          >
            <ul aria-label="Projects">
              {shown?.map((project, index) => (
                <ProjectRow
                  index={index}
                  key={project.id}
                  project={project}
                  sortable={sortable}
                  moving={reorder.moving}
                  sorting={words === ""}
                />
              ))}
            </ul>
          </SortableList>
        </div>
      </div>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/projects/")({
  component: Projects,
  head: () => pageHead("Projects"),
});

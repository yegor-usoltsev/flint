import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { LoadFailed } from "~/components/load-failed";
import { Page } from "~/components/page";
import { RouteNotFound } from "~/components/route-not-found";
import { Skeleton } from "~/components/ui/skeleton";
import { isNotFound, useMe } from "~/lib/api";
import type { ProjectDetail } from "~/lib/api-types";
import { projectQuery, projectsQuery } from "~/lib/queries";
import { usePageTitle } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

export const ProjectPage = ({
  renderActions,
  children,
  className,
}: {
  renderActions?: (project: ProjectDetail) => ReactNode;
  children: (project: ProjectDetail) => ReactNode;
  className?: string;
}) => {
  const workspace = useWorkspace();
  const { key = "" } = useParams({ strict: false });
  const project = useQuery(projectQuery(key));
  const projects = useQuery(projectsQuery(workspace.slug));

  const owner = useMe().data?.workspaces.find(
    (item) => item.slug === project.data?.workspaceSlug
  );

  const name = projects.data?.find((item) => item.key === key)?.name ?? key;

  usePageTitle(project.data?.name);

  if (project.isError && isNotFound(project.error)) {
    return <RouteNotFound />;
  }

  if (owner !== undefined && owner.id !== workspace.id) {
    return (
      <Navigate
        params={{ key, slug: owner.slug }}
        replace
        search={(previous) => previous}
        to="/$slug/project/$key"
      />
    );
  }

  return (
    <Page
      actions={
        project.data === undefined ? undefined : renderActions?.(project.data)
      }
      className={className}
      crumbs={[
        {
          label: workspace.name,
          short: workspace.name,
          link: (
            <Link params={{ slug: workspace.slug }} to="/$slug/my-issues" />
          ),
        },
      ]}
      title={project.data?.name ?? name}
    >
      {project.data === undefined ? null : children(project.data)}
      {project.isPending ? (
        <div aria-busy className="flex flex-col gap-2 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : null}
      {project.isError && project.data === undefined ? (
        <LoadFailed
          className="m-4"
          error={project.error}
          onRetry={() => {
            void project.refetch();
          }}
          title={`Could not load ${name}`}
        />
      ) : null}
    </Page>
  );
};

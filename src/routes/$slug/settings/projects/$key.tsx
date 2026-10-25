import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

import { ConfirmDelete } from "~/components/confirm-delete";
import { IconPicker } from "~/components/icon-picker";
import { LoadFailed } from "~/components/load-failed";
import { ProjectIcon } from "~/components/project-icon";
import { RouteNotFound } from "~/components/route-not-found";
import {
  backLink,
  SettingsInput,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "~/components/settings-page";
import { Skeleton } from "~/components/ui/skeleton";
import { isNotFound, request } from "~/lib/api";
import type { ProjectDetail } from "~/lib/api-types";
import type { Body } from "~/lib/endpoints";
import { notifyError } from "~/lib/notify";
import { projectQuery, projectsQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const ProjectSettings = ({ project }: { project: ProjectDetail }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const isAdmin = workspace.role === "admin";
  const { queryKey } = projectQuery(project.key);

  const update = useMutation({
    mutationFn: async (changes: Body<"PATCH /projects/:key">) =>
      await request("PATCH /projects/:key", {
        body: changes,
        params: { key: project.key },
      }),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (current) =>
        current === undefined ? current : { ...current, ...changes }
      );

      return previous;
    },
    onError: (error, _changes, previous) => {
      queryClient.setQueryData(queryKey, previous);
      notifyError("Project not saved")(error);
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKey, saved);
      await queryClient.invalidateQueries({
        queryKey: projectsQuery(workspace.slug).queryKey,
      });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await request("DELETE /projects/:key", { params: { key: project.key } });
    },
    onError: notifyError("Project not deleted"),
    onSuccess: async () => {
      await navigate({
        params: { slug: workspace.slug },
        replace: true,
        to: "/$slug/settings/projects",
      });
      queryClient.removeQueries({ queryKey });
      await queryClient.invalidateQueries({
        queryKey: projectsQuery(workspace.slug).queryKey,
      });
    },
  });

  return (
    <>
      <SettingsSection>
        <SettingsRow
          description="Shown in the sidebar and on every issue key"
          label="Icon and color"
        >
          <IconPicker
            color={project.color}
            disabled={!isAdmin}
            icon={project.icon}
            label="Project icon"
            onChange={(change) => {
              update.mutate(change);
            }}
          />
        </SettingsRow>
        <SettingsRow htmlFor="project-name" label="Name">
          <SettingsInput
            disabled={!isAdmin}
            id="project-name"
            maxLength={60}
            onSave={async (name) => {
              await update.mutateAsync({ name });
            }}
            value={project.name}
          />
        </SettingsRow>
        <SettingsRow
          description="Issue keys, Git references and /issue links use it, so it never changes"
          label="Key"
        >
          <span className="text-muted-foreground tracking-key">
            {project.key}
          </span>
        </SettingsRow>
      </SettingsSection>
      {isAdmin ? (
        <SettingsSection title="Danger zone">
          <SettingsRow
            description="Deletes its issues, comments and attachments"
            label="Delete project"
          >
            <ConfirmDelete
              action="Delete project"
              confirmText={project.key}
              description={`Every ${project.key} issue with its comments, activity and attachments is deleted for all members. It cannot be undone.`}
              onConfirm={() => {
                remove.mutate();
              }}
              pending={remove.isPending}
              title={`Delete ${project.name}?`}
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </>
  );
};

const ProjectSettingsPage = () => {
  const { key } = Route.useParams();
  const workspace = useWorkspace();
  const project = useQuery(projectQuery(key.toUpperCase()));

  if (project.isError && isNotFound(project.error)) {
    return <RouteNotFound />;
  }

  return (
    <SettingsPage
      back={
        <Link
          className={backLink}
          params={{ slug: workspace.slug }}
          to="/$slug/settings/projects"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          Projects
        </Link>
      }
      title={
        project.data === undefined ? (
          key.toUpperCase()
        ) : (
          <span className="flex items-center gap-3">
            <span className="bg-surface-2 flex size-10 shrink-0 items-center justify-center rounded-lg">
              <ProjectIcon
                className="size-5"
                color={project.data.color}
                icon={project.data.icon}
              />
            </span>
            <span className="truncate">{project.data.name}</span>
          </span>
        )
      }
    >
      {project.isPending ? <Skeleton className="h-48 w-full" /> : null}
      {project.isError && project.data === undefined ? (
        <LoadFailed
          error={project.error}
          onRetry={() => {
            void project.refetch();
          }}
          title="Project could not load"
        />
      ) : null}
      {project.data === undefined ? null : (
        <ProjectSettings project={project.data} />
      )}
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/projects/$key")({
  component: ProjectSettingsPage,
  head: ({ params }) => pageHead(params.key.toUpperCase()),
});

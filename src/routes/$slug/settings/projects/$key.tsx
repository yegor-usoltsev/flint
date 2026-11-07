import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LockIcon } from "lucide-react";

import { ConfirmDelete } from "~/components/confirm-delete";
import { IconPicker } from "~/components/icon-picker";
import { LoadFailed } from "~/components/load-failed";
import { RouteNotFound } from "~/components/route-not-found";
import {
  SettingsInput,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  useSettingsSave,
} from "~/components/settings-page";
import { buttonVariants } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { isNotFound, request } from "~/lib/api";
import type { ProjectDetail } from "~/lib/api-types";
import type { Body } from "~/lib/endpoints";
import { notifyError } from "~/lib/notify";
import { projectQuery, projectsQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const useProjectUpdate = (project: ProjectDetail) => {
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const { queryKey } = projectQuery(project.key);

  return useMutation({
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
    onError: (_error, _changes, previous) => {
      queryClient.setQueryData(queryKey, previous);
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKey, saved);
      await queryClient.invalidateQueries({
        queryKey: projectsQuery(workspace.slug).queryKey,
      });
    },
  });
};

const ProjectIconPicker = ({ project }: { project: ProjectDetail }) => {
  const workspace = useWorkspace();
  const update = useProjectUpdate(project);
  const { saveInBackground } = useSettingsSave();

  return (
    <IconPicker
      color={project.color}
      disabled={workspace.role !== "admin"}
      icon={project.icon}
      label="Project icon"
      onChange={(change) => {
        saveInBackground("icon", async () => {
          await update.mutateAsync(change);
        });
      }}
    />
  );
};

const ProjectSettings = ({ project }: { project: ProjectDetail }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const isAdmin = workspace.role === "admin";
  const { queryKey } = projectQuery(project.key);

  const update = useProjectUpdate(project);

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
          <span className="text-muted-foreground tracking-key bg-muted inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-xs">
            <LockIcon aria-hidden className="size-3" />
            {project.key}
          </span>
        </SettingsRow>
      </SettingsSection>
      {isAdmin ? (
        <SettingsSection title="Danger zone">
          <SettingsRow
            description="Deletes its issues, comments and attachments"
            label="Delete project"
            stacked
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
      parent={{
        label: "Projects",
        link: (
          <Link
            params={{ slug: workspace.slug }}
            to="/$slug/settings/projects"
          />
        ),
      }}
      actions={
        <Link
          className={buttonVariants({
            className: "max-sm:h-10",
            variant: "outline",
          })}
          params={{ key: key.toUpperCase(), slug: workspace.slug }}
          to="/$slug/project/$key"
        >
          Open project
        </Link>
      }
      leading={
        project.data === undefined ? undefined : (
          <ProjectIconPicker project={project.data} />
        )
      }
      title={project.data?.name ?? key.toUpperCase()}
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

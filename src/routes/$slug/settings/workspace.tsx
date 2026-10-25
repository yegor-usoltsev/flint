import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";

import { ColorSwatches } from "~/components/color-picker";
import { ConfirmDelete } from "~/components/confirm-delete";
import {
  SettingsInput,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "~/components/settings-page";
import { Button } from "~/components/ui/button";
import { WorkspaceLogo } from "~/components/workspace-logo";
import { meQuery, request } from "~/lib/api";
import type { Workspace } from "~/lib/api-types";
import type { Body } from "~/lib/endpoints";
import { notifyError } from "~/lib/notify";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";
import {
  forgetWorkspace,
  lastWorkspace,
  nextWorkspace,
  slugProblem,
  withoutWorkspace,
} from "~/lib/workspace";

const imageTypes = "image/png,image/jpeg,image/webp,image/avif";

const useSaveWorkspace = (workspace: Workspace) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const store = async (saved: Workspace) => {
    queryClient.setQueryData(meQuery.queryKey, (me) =>
      me
        ? {
            ...me,
            workspaces: [
              ...me.workspaces.map((item) =>
                item.id === saved.id ? saved : item
              ),
              ...(saved.slug === workspace.slug ? [] : [workspace]),
            ],
          }
        : me
    );

    if (saved.slug !== workspace.slug) {
      await navigate({
        params: { slug: saved.slug },
        replace: true,
        to: "/$slug/settings/workspace",
      });
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    }
  };

  const update = useMutation({
    mutationFn: async (changes: Body<"PATCH /workspaces/:slug">) =>
      await request("PATCH /workspaces/:slug", {
        body: changes,
        params: { slug: workspace.slug },
      }),
    onError: notifyError("Workspace not saved"),
    onSuccess: store,
  });

  const logo = useMutation({
    mutationFn: async (file: File | null) => {
      if (file === null) {
        return await request("DELETE /workspaces/:slug/logo", {
          params: { slug: workspace.slug },
        });
      }

      const body = new FormData();
      body.append("file", file);

      return await request("PUT /workspaces/:slug/logo", {
        body,
        params: { slug: workspace.slug },
      });
    },
    onError: notifyError("Logo not saved"),
    onSuccess: store,
  });

  return { logo, update };
};

const LogoSetting = ({
  disabled,
  logo,
  workspace,
}: {
  disabled: boolean;
  logo: ReturnType<typeof useSaveWorkspace>["logo"];
  workspace: Workspace;
}) => {
  const input = useRef<HTMLInputElement>(null);

  return (
    <SettingsRow description="Recommended size is 256×256 px" label="Logo">
      <div className="flex items-center gap-2">
        {disabled ? null : (
          <>
            {workspace.logoUrl === null ? null : (
              <Button
                disabled={logo.isPending}
                onClick={() => {
                  logo.mutate(null);
                }}
                variant="ghost"
              >
                Remove
              </Button>
            )}
            <Button
              disabled={logo.isPending}
              onClick={() => {
                input.current?.click();
              }}
              variant="outline"
            >
              {workspace.logoUrl === null ? "Upload" : "Replace"}
            </Button>
            <input
              accept={imageTypes}
              aria-label="Upload a workspace logo"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";

                if (file !== undefined) {
                  logo.mutate(file);
                }
              }}
              ref={input}
              tabIndex={-1}
              type="file"
            />
          </>
        )}
        <WorkspaceLogo
          className="text-prose size-10 rounded-lg"
          workspace={workspace}
        />
      </div>
    </SettingsRow>
  );
};

const DeleteWorkspace = ({ workspace }: { workspace: Workspace }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const remove = useMutation({
    mutationFn: async () => {
      await request("DELETE /workspaces/:slug", {
        params: { slug: workspace.slug },
      });
    },
    onError: notifyError("Workspace not deleted"),
    onSuccess: async () => {
      const me = queryClient.getQueryData(meQuery.queryKey);

      const target = nextWorkspace(
        me?.workspaces ?? [],
        workspace.slug,
        lastWorkspace()
      );

      const drop = () => {
        forgetWorkspace(workspace.slug);
        queryClient.setQueryData(meQuery.queryKey, (current) =>
          withoutWorkspace(current, workspace.id)
        );
      };

      if (target === null) {
        drop();
        await navigate({ replace: true, to: "/" });
      } else {
        await navigate({
          params: { slug: target },
          replace: true,
          to: "/$slug/my-issues",
        });
        drop();
      }

      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    },
  });

  return (
    <ConfirmDelete
      action="Delete workspace"
      confirmText={workspace.slug}
      description="This deletes its projects, issues, comments, wiki pages, labels and attachments for every member. It cannot be undone."
      onConfirm={() => {
        remove.mutate();
      }}
      pending={remove.isPending}
      title={`Delete ${workspace.name}?`}
    />
  );
};

const General = () => {
  const workspace = useWorkspace();
  const { logo, update } = useSaveWorkspace(workspace);
  const isAdmin = workspace.role === "admin";
  const host = typeof window === "undefined" ? "" : window.location.host;

  return (
    <SettingsPage
      description={
        isAdmin ? undefined : "Only workspace admins change these settings."
      }
      title="General"
    >
      <SettingsSection>
        <LogoSetting disabled={!isAdmin} logo={logo} workspace={workspace} />
        <SettingsRow htmlFor="workspace-name" label="Name">
          <SettingsInput
            disabled={!isAdmin}
            id="workspace-name"
            maxLength={60}
            onSave={async (name) => {
              await update.mutateAsync({ name });
            }}
            value={workspace.name}
          />
        </SettingsRow>
        <SettingsRow
          description="Changing it breaks old links to this workspace; /issue and /doc links keep working."
          htmlFor="workspace-slug"
          label="URL"
        >
          <SettingsInput
            disabled={!isAdmin}
            id="workspace-slug"
            maxLength={40}
            onSave={async (slug) => {
              await update.mutateAsync({ slug });
            }}
            prefix={`${host}/`}
            validate={(slug) => slugProblem(slug.toLowerCase())}
            value={workspace.slug}
          />
        </SettingsRow>
        <SettingsRow
          description="Without a logo the initial shows on this color"
          label="Color"
        >
          <ColorSwatches
            disabled={!isAdmin}
            label="Workspace color"
            onChange={(color) => {
              update.mutate({ color });
            }}
            value={workspace.color}
          />
        </SettingsRow>
      </SettingsSection>
      {isAdmin ? (
        <SettingsSection title="Danger zone">
          <SettingsRow
            description="Deletes the workspace and everything in it"
            label="Delete workspace"
          >
            <DeleteWorkspace workspace={workspace} />
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/workspace")({
  component: General,
  head: () => pageHead("General"),
});

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowUpRightIcon } from "lucide-react";

import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "~/components/settings-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button, buttonVariants } from "~/components/ui/button";
import { UserAvatar } from "~/components/user-avatar";
import { meQuery, request, useMe } from "~/lib/api";
import type { Me, Workspace } from "~/lib/api-types";
import { notifyError } from "~/lib/notify";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const LeaveWorkspace = ({
  me,
  workspace,
}: {
  me: Me;
  workspace: Workspace;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const leave = useMutation({
    mutationFn: async () => {
      await request("DELETE /workspaces/:slug/members/:username", {
        params: { slug: workspace.slug, username: me.username },
      });
    },
    onError: notifyError("Could not leave the workspace"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      await navigate({ to: "/" });
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" />}>
        Leave workspace
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {workspace.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            You lose access to its projects and wiki until an admin adds you
            again. Your issues and comments stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={leave.isPending}
            onClick={() => {
              leave.mutate();
            }}
            variant="destructive"
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const Profile = () => {
  const { data: me } = useMe();
  const workspace = useWorkspace();

  if (me === undefined || me === null) {
    return null;
  }

  return (
    <SettingsPage
      description="Flint shows your Gitea profile. Change it in Gitea; Flint picks it up at your next sign-in."
      title="Profile"
    >
      <SettingsSection
        action={
          <a
            className={cn(buttonVariants({ variant: "ghost" }))}
            href={new URL("/user/settings", me.giteaUrl).href}
            rel="noreferrer"
            target="_blank"
          >
            Edit in Gitea
            <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        }
        title="Gitea account"
      >
        <SettingsRow label="Profile picture">
          <UserAvatar
            avatarUrl={me.avatarUrl}
            className="size-10"
            name={me.displayName}
          />
        </SettingsRow>
        <SettingsRow label="Full name">
          <span className="text-muted-foreground truncate">
            {me.displayName}
          </span>
        </SettingsRow>
        <SettingsRow label="Username">
          <span className="text-muted-foreground truncate">@{me.username}</span>
        </SettingsRow>
        <SettingsRow label="Email">
          <span className="text-muted-foreground truncate">
            {me.email === "" ? "Not shared by Gitea" : me.email}
          </span>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Workspace access">
        <SettingsRow label={`Remove yourself from ${workspace.name}`}>
          <LeaveWorkspace me={me} workspace={workspace} />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/account/profile")({
  component: Profile,
  head: () => pageHead("Profile"),
});

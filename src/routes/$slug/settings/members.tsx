import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { LoadFailed } from "~/components/load-failed";
import {
  SettingsFilter,
  SettingsPage,
  TableEmpty,
  tableDate,
  tableGroup,
  tableHead,
  tableRow,
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
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/user-avatar";
import { meQuery, request, useMe } from "~/lib/api";
import type { Member, Role } from "~/lib/api-types";
import { formatDate } from "~/lib/issue-view";
import { notifyError } from "~/lib/notify";
import { membersQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const roles = [
  { label: "Member", value: "member" },
  { label: "Admin", value: "admin" },
] as const;

const isRole = (value: unknown): value is Role =>
  value === "admin" || value === "member";

const RoleSelect = ({
  id,
  label,
  onChange,
  size = "default",
  value,
}: {
  id?: string;
  label: string;
  onChange: (role: Role) => void;
  size?: "default" | "sm";
  value: Role;
}) => (
  <Select
    items={roles}
    onValueChange={(role) => {
      if (isRole(role)) {
        onChange(role);
      }
    }}
    value={value}
  >
    <SelectTrigger
      aria-label={label}
      className="hit-area relative w-28"
      id={id}
      size={size}
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        {roles.map((role) => (
          <SelectItem key={role.value} value={role.value}>
            {role.label}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  </Select>
);

const AddMember = ({ slug }: { slug: string }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("member");

  const add = useMutation({
    mutationFn: async () =>
      await request("POST /workspaces/:slug/members", {
        body: { role, username },
        params: { slug },
      }),
    onSuccess: async () => {
      setUsername("");
      setRole("member");
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: membersQuery(slug).queryKey,
      });
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    add.mutate();
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        add.reset();
      }}
      open={open}
    >
      <DialogTrigger render={<Button size="pill" />}>Add member</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Add people by their Gitea username. Someone who has not signed in to
            Flint yet joins on their first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-6" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="member-username">Gitea username</FieldLabel>
              <Input
                aria-describedby={add.isError ? "add-member-error" : undefined}
                aria-invalid={add.isError || undefined}
                autoCapitalize="none"
                autoComplete="off"
                autoFocus
                id="member-username"
                maxLength={41}
                onChange={(event) => {
                  setUsername(event.target.value);
                  add.reset();
                }}
                placeholder="alice"
                required
                spellCheck={false}
                value={username}
              />
              {add.isError ? (
                <FieldError id="add-member-error">
                  {add.error.message}
                </FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="member-role">Role</FieldLabel>
              <RoleSelect
                id="member-role"
                label="Role"
                onChange={setRole}
                value={role}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={add.isPending} type="submit">
              Add member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const RemoveMember = ({ member, slug }: { member: Member; slug: string }) => {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: async () => {
      await request("DELETE /workspaces/:slug/members/:username", {
        params: { slug, username: member.username },
      });
    },
    onError: notifyError("Could not remove"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: membersQuery(slug).queryKey,
      });
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            aria-label={`Remove @${member.username}`}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <XIcon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove @{member.username}?</AlertDialogTitle>
          <AlertDialogDescription>
            {member.pending
              ? "The invite is withdrawn."
              : "They lose access to this workspace right away. Their issues and comments stay."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
            variant="destructive"
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const MemberRow = ({
  canManage,
  isSelf,
  member,
  slug,
}: {
  canManage: boolean;
  isSelf: boolean;
  member: Member;
  slug: string;
}) => {
  const queryClient = useQueryClient();
  const { queryKey } = membersQuery(slug);

  const changeRole = useMutation({
    mutationFn: async (role: Role) =>
      await request("PATCH /workspaces/:slug/members/:username", {
        body: { role },
        params: { slug, username: member.username },
      }),
    onMutate: async (role) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (members) =>
        members?.map((item) =>
          item.username === member.username ? { ...item, role } : item
        )
      );

      return previous;
    },
    onError: (error, _role, previous) => {
      queryClient.setQueryData(queryKey, previous);
      notifyError("Role not changed")(error);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey });

      if (isSelf) {
        await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      }
    },
  });

  return (
    <li className={tableRow}>
      <UserAvatar
        avatarUrl={member.avatarUrl}
        className="size-6"
        name={member.displayName}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">
          {member.displayName}
          {isSelf ? (
            <span className="text-muted-foreground font-normal"> (you)</span>
          ) : null}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          @{member.username}
        </span>
      </div>
      <div className="flex w-28 shrink-0 md:w-32">
        {canManage ? (
          <RoleSelect
            label={`Role of @${member.username}`}
            onChange={(role) => {
              changeRole.mutate(role);
            }}
            size="sm"
            value={member.role}
          />
        ) : (
          <span className="text-muted-foreground capitalize">
            {member.role}
          </span>
        )}
      </div>
      <span className={tableDate}>
        <span className="sr-only">
          {member.pending ? "Invited" : "Joined"}{" "}
        </span>
        {formatDate(member.joinedAt)}
      </span>
      <div className="flex w-7 shrink-0 justify-end">
        {canManage && !isSelf ? (
          <RemoveMember member={member} slug={slug} />
        ) : null}
      </div>
    </li>
  );
};

const MemberGroup = ({
  canManage,
  label,
  meId,
  members,
  slug,
}: {
  canManage: boolean;
  label: string;
  meId: string | undefined;
  members: Member[];
  slug: string;
}) => {
  if (members.length === 0) {
    return null;
  }

  return (
    <section aria-label={label} className="flex flex-col">
      <h2 className={tableGroup}>
        {label}
        <span className="text-muted-foreground font-normal">
          {members.length}
        </span>
      </h2>
      <ul>
        {members.map((member) => (
          <MemberRow
            canManage={canManage}
            isSelf={member.userId === meId}
            key={member.username}
            member={member}
            slug={slug}
          />
        ))}
      </ul>
    </section>
  );
};

const Members = () => {
  const workspace = useWorkspace();
  const { data: me } = useMe();
  const members = useQuery(membersQuery(workspace.slug));
  const [filter, setFilter] = useState("");
  const isAdmin = workspace.role === "admin";
  const words = filter.trim().toLowerCase();

  const shown = members.data?.filter(
    (member) =>
      member.displayName.toLowerCase().includes(words) ||
      member.username.toLowerCase().includes(words)
  );

  return (
    <SettingsPage
      actions={isAdmin ? <AddMember slug={workspace.slug} /> : undefined}
      description={
        isAdmin
          ? "People sign in with Gitea; add them by their Gitea username."
          : "Workspace admins add and remove members."
      }
      title="Members"
      wide
    >
      <div className="flex flex-col gap-2">
        <SettingsFilter
          label="Search by name or username"
          onChange={setFilter}
          value={filter}
        />
        <div aria-hidden className={tableHead}>
          <span className="flex-1 pl-9">Name</span>
          <span className="w-28 md:w-32">Role</span>
          <span className={tableDate}>Joined</span>
          <span className="w-7" />
        </div>
        {members.isPending ? <Skeleton className="h-20 w-full" /> : null}
        {members.isError && members.data === undefined ? (
          <LoadFailed
            error={members.error}
            onRetry={() => {
              void members.refetch();
            }}
            title="Members could not load"
          />
        ) : null}
        {shown?.length === 0 ? (
          <TableEmpty
            description="Add people by their Gitea username."
            filter={filter.trim()}
            onClearFilter={() => {
              setFilter("");
            }}
            title="No members"
          />
        ) : null}
        {shown === undefined ? null : (
          <div className="flex flex-col gap-2">
            <MemberGroup
              canManage={isAdmin}
              label="Active"
              meId={me?.id}
              members={shown.filter((member) => !member.pending)}
              slug={workspace.slug}
            />
            <MemberGroup
              canManage={isAdmin}
              label="Invited"
              meId={me?.id}
              members={shown.filter((member) => member.pending)}
              slug={workspace.slug}
            />
          </div>
        )}
      </div>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/members")({
  component: Members,
  head: () => pageHead("Members"),
});

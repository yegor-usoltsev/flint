import { Menu } from "@base-ui/react/menu";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleDotIcon,
  CopyIcon,
  KeyboardIcon,
  LinkIcon,
  LogOutIcon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  SunMoonIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useOpenHelp, useOpenPalette } from "~/components/command-palette";
import { useCreateIssue } from "~/components/create-issue";
import { RootMenuFilter } from "~/components/menu-filter";
import { ProjectDialog } from "~/components/project-dialog";
import { ProjectIcon } from "~/components/project-icon";
import { FlintMark } from "~/components/sign-in";
import { Button } from "~/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "~/components/ui/sidebar";
import { UserAvatar } from "~/components/user-avatar";
import { WikiTree } from "~/components/wiki-tree";
import { WorkspaceDialog } from "~/components/workspace-dialog";
import { WorkspaceLogo } from "~/components/workspace-logo";
import { signOut } from "~/lib/api";
import type { Me, Project, Workspace } from "~/lib/api-types";
import { copyText } from "~/lib/copy";
import { projectsQuery } from "~/lib/queries";
import { settingsGroups } from "~/lib/settings-groups";
import { isTheme, setTheme, themeItems, useTheme } from "~/lib/theme";
import { workspaceWiki } from "~/lib/wiki";

const WorkspaceSwitcher = ({
  me,
  workspace,
}: {
  me: Me;
  workspace: Workspace;
}) => {
  const [creating, setCreating] = useState(false);
  const { slug } = workspace;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton aria-label={`Workspace: ${workspace.name}`} />
            }
          >
            <WorkspaceLogo workspace={workspace} />
            <span className="font-strong flex-1 truncate">
              {workspace.name}
            </span>
            <ChevronsUpDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {me.workspaces.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  render={
                    <Link params={{ slug: item.slug }} to="/$slug/my-issues" />
                  }
                >
                  <WorkspaceLogo className="size-4" workspace={item} />
                  <span className="truncate">{item.name}</span>
                  {item.id === workspace.id ? (
                    <CheckIcon className="ml-auto" />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => {
                  setCreating(true);
                }}
              >
                <PlusIcon />
                Create workspace…
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={
                  <Link params={{ slug }} to="/$slug/settings/workspace" />
                }
              >
                <SettingsIcon />
                Workspace settings
              </DropdownMenuItem>
              <DropdownMenuItem
                render={<Link params={{ slug }} to="/$slug/settings/members" />}
              >
                <UsersRoundIcon />
                Manage members
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <WorkspaceDialog onOpenChange={setCreating} open={creating} />
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

const SettingsMenu = ({ slug }: { slug: string }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button aria-label="Settings" size="icon-sm" variant="ghost" />}
    >
      <SettingsIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-48" side="top">
      {settingsGroups.map((group) => (
        <DropdownMenuGroup key={group.label}>
          <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
          {group.items.map((item) => (
            <DropdownMenuItem
              key={item.to}
              render={<Link params={{ slug }} to={item.to} />}
            >
              <item.icon />
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        render={<Link params={{ slug }} to="/$slug/settings" />}
      >
        All settings
        <DropdownMenuShortcut>G then S</DropdownMenuShortcut>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const AccountMenu = ({ me, slug }: { me: Me; slug: string }) => {
  const theme = useTheme();
  const openHelp = useOpenHelp();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            aria-label={`Account: ${me.displayName}`}
            className="min-w-0 flex-1"
            size="lg"
          />
        }
      >
        <UserAvatar
          avatarUrl={me.avatarUrl}
          className="size-7"
          name={me.displayName}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{me.displayName}</span>
          <span className="text-muted-foreground truncate text-xs">
            @{me.username}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate">@{me.username}</span>
          </DropdownMenuLabel>
          <DropdownMenuItem
            render={
              <Link params={{ slug }} to="/$slug/settings/account/profile" />
            }
          >
            <UserRoundIcon />
            Profile
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SunMoonIcon />
              Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={(value) => {
                  if (isTheme(value)) {
                    setTheme(value);
                  }
                }}
                value={theme}
              >
                {themeItems.map((item) => (
                  <DropdownMenuRadioItem key={item.value} value={item.value}>
                    {item.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {openHelp === null ? null : (
            <DropdownMenuItem onClick={openHelp}>
              <KeyboardIcon />
              Keyboard shortcuts
              <DropdownMenuShortcut>?</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void signOut();
          }}
        >
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const useWikiPath = (prefix: string) => {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const { _splat: path = "" } = useParams({ strict: false });

  return pathname === prefix || pathname.startsWith(`${prefix}/`) ? path : null;
};

const ProjectItem = ({
  isAdmin,
  project,
}: {
  isAdmin: boolean;
  project: Project;
}) => {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");

  return (
    <Menu.FilterProvider autoHighlight onValueChange={setQuery} value={query}>
      <ContextMenu>
        <ContextMenuTrigger render={<SidebarMenuItem />}>
          <SidebarMenuButton
            render={
              <Link
                params={{ key: project.key, slug: project.workspaceSlug }}
                to="/$slug/project/$key"
              />
            }
          >
            <ProjectIcon color={project.color} icon={project.icon} />
            <span className="truncate">{project.name}</span>
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent
          aria-label={`${project.name} actions`}
          className="w-45"
        >
          <RootMenuFilter query={query} />
          <Menu.List>
            {isAdmin ? (
              <DropdownMenuItem
                onClick={() => {
                  setEditing(true);
                }}
              >
                <SettingsIcon />
                Project settings
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => {
                void copyText(
                  new URL(
                    `/${project.workspaceSlug}/project/${project.key}`,
                    window.location.origin
                  ).href,
                  "project URL"
                );
              }}
            >
              <LinkIcon />
              Copy URL
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void copyText(project.key, "project key");
              }}
            >
              <CopyIcon />
              Copy key
            </DropdownMenuItem>
          </Menu.List>
        </ContextMenuContent>
        {isAdmin ? (
          <ProjectDialog
            onOpenChange={setEditing}
            open={editing}
            project={project}
            slug={project.workspaceSlug}
          />
        ) : null}
      </ContextMenu>
    </Menu.FilterProvider>
  );
};

const Projects = ({ workspace }: { workspace: Workspace }) => {
  const projects = useQuery(projectsQuery(workspace.slug));
  const [creating, setCreating] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const isAdmin = workspace.role === "admin";

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      {isAdmin ? (
        <SidebarGroupAction
          aria-label="Create project"
          onClick={() => {
            setCreating(true);
          }}
          ref={opener}
        >
          <PlusIcon />
        </SidebarGroupAction>
      ) : null}
      <SidebarMenu>
        {projects.isPending
          ? [0, 1, 2].map((index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuSkeleton />
              </SidebarMenuItem>
            ))
          : null}
        {projects.isError && projects.data === undefined ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => {
                void projects.refetch();
              }}
            >
              <RotateCwIcon />
              <span>Projects not loaded · Retry</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {projects.data?.map((project) => (
          <ProjectItem isAdmin={isAdmin} key={project.id} project={project} />
        ))}
        {projects.data?.length === 0 && isAdmin ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => {
                setCreating(true);
              }}
            >
              <PlusIcon />
              <span>Create a project</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {projects.data?.length === 0 && !isAdmin ? (
          <li className="text-muted-foreground px-2 py-1.5 text-xs">
            No projects yet
          </li>
        ) : null}
      </SidebarMenu>
      <ProjectDialog
        onOpenChange={setCreating}
        open={creating}
        opener={opener}
        slug={workspace.slug}
      />
    </SidebarGroup>
  );
};

export const AppSidebar = ({
  me,
  workspace,
}: {
  me: Me;
  workspace: Workspace;
}) => {
  const { slug } = workspace;
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const createIssue = useCreateIssue();
  const openPalette = useOpenPalette();
  const wikiPath = useWikiPath(`/${slug}/wiki`);

  useEffect(
    () =>
      router.subscribe("onResolved", () => {
        setOpenMobile(false);
      }),
    [router, setOpenMobile]
  );

  return (
    <Sidebar variant="inset">
      <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col">
        <SidebarHeader>
          <div className="flex items-center gap-1 md:mb-1">
            <Link
              aria-label="Flint home"
              className="hit-area focus-visible:ring-ring relative mr-auto flex h-7 items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-2"
              to="/"
            >
              <FlintMark className="size-4.5" />
              <span className="font-strong">Flint</span>
            </Link>
            {openPalette === null ? null : (
              <Button
                aria-keyshortcuts="Meta+K"
                aria-label="Search"
                onClick={() => {
                  setOpenMobile(false);
                  openPalette();
                }}
                size="icon-sm"
                variant="ghost"
              >
                <SearchIcon />
              </Button>
            )}
            <Button
              aria-keyshortcuts="C"
              aria-label="New issue"
              onClick={() => {
                setOpenMobile(false);
                createIssue();
              }}
              size="icon-round"
              variant="secondary"
            >
              <SquarePenIcon />
            </Button>
          </div>
          <WorkspaceSwitcher me={me} workspace={workspace} />
        </SidebarHeader>
        <SidebarContent className="md:mt-1">
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link params={{ slug }} to="/$slug/my-issues" />}
                >
                  <CircleDotIcon />
                  <span>My issues</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={
                    <Link
                      activeOptions={{ exact: true }}
                      params={{ _splat: "", slug }}
                      to="/$slug/wiki/$"
                    />
                  }
                >
                  <BookOpenIcon />
                  <span>Wiki</span>
                </SidebarMenuButton>
                {wikiPath === null ? null : (
                  <WikiTree
                    current={wikiPath}
                    wiki={workspaceWiki(workspace)}
                  />
                )}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <Projects workspace={workspace} />
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-1">
            <AccountMenu me={me} slug={slug} />
            <SettingsMenu slug={slug} />
          </div>
        </SidebarFooter>
      </nav>
    </Sidebar>
  );
};

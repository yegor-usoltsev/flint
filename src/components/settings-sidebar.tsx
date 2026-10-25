import { Link, useRouter } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar";
import { useBackToApp } from "~/lib/back-to-app";
import { build } from "~/lib/build";
import { settingsGroups } from "~/lib/settings-groups";
import { useCommands } from "~/lib/use-hotkey";

export const BackToApp = ({
  children,
  className,
  slug,
}: {
  children: ReactNode;
  className?: string;
  slug: string;
}) => {
  const back = useBackToApp(slug);

  return (
    <Link
      className={className}
      onClick={back}
      params={{ slug }}
      to="/$slug/my-issues"
    >
      {children}
    </Link>
  );
};

export const SettingsSidebar = ({ slug }: { slug: string }) => {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const back = useBackToApp(slug);

  useEffect(
    () =>
      router.subscribe("onResolved", () => {
        setOpenMobile(false);
      }),
    [router, setOpenMobile]
  );

  useCommands([
    {
      group: "Navigation",
      hotkey: { keys: "escape", mod: true },
      id: "back-to-app",
      label: "Back to app",
      run: () => {
        back();
      },
    },
  ]);

  return (
    <Sidebar variant="inset">
      <nav aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={
                  <Link
                    onClick={back}
                    params={{ slug }}
                    to="/$slug/my-issues"
                  />
                }
              >
                <ChevronLeftIcon />
                <span>Back to app</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {settingsGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      render={<Link params={{ slug }} to={item.to} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <p className="text-muted-foreground px-2 text-xs">
            Flint {build.version} ({build.commit})
          </p>
        </SidebarFooter>
      </nav>
    </Sidebar>
  );
};

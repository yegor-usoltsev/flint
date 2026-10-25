import { cn } from "cn";
import { CloudOffIcon, SearchIcon } from "lucide-react";
import { Fragment } from "react";
import type { ReactElement, ReactNode } from "react";

import { useOpenPalette } from "~/components/command-palette";
import { Keys } from "~/components/shortcuts-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useRealtimeConnected } from "~/lib/realtime";

export interface Crumb {
  label: string;
  link: ReactElement;
  short?: string;
}

const noCrumbs: Crumb[] = [];

const Disconnected = () => (
  <output className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
    <CloudOffIcon aria-hidden className="size-3.5" />
    <span className="hidden sm:inline">Reconnecting…</span>
    <span className="sr-only sm:hidden">Reconnecting</span>
  </output>
);

const SearchButton = () => {
  const openPalette = useOpenPalette();

  if (openPalette === null) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Search"
            className="md:hidden"
            onClick={openPalette}
            size="icon"
            variant="ghost"
          />
        }
      >
        <SearchIcon />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Search
        <Keys hotkey={{ keys: "k", mod: true }} />
      </TooltipContent>
    </Tooltip>
  );
};

export const PagePending = () => (
  <div aria-busy className="flex min-h-0 flex-1 flex-col">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <h1 className="sr-only">Loading</h1>
      <Skeleton className="h-4 w-40" />
    </header>
    <div className="flex flex-col gap-2 p-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-2/3" />
    </div>
  </div>
);

export const Page = ({
  actions,
  children,
  className,
  crumbs = noCrumbs,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  crumbs?: Crumb[];
  title: string;
}) => {
  const connected = useRealtimeConnected();
  const scope = crumbs.findLast((crumb) => crumb.short !== undefined);

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger className="-ml-1" />
        <Separator
          className="mr-1 data-vertical:h-4 data-vertical:self-center"
          orientation="vertical"
        />
        <Breadcrumb className="@container min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap">
            {crumbs.map((crumb, index) => {
              const hidden = cn(
                crumb !== scope && "max-md:hidden",
                index === crumbs.length - 1
                  ? "md:@max-3xs:hidden"
                  : "md:@max-lg:hidden"
              );

              return (
                <Fragment key={crumb.label}>
                  <BreadcrumbItem
                    className={cn("min-w-6 shrink-[100]", hidden)}
                  >
                    <BreadcrumbLink
                      className="hit-area relative min-w-0"
                      render={crumb.link}
                    >
                      <span className="block max-w-60 truncate max-md:hidden">
                        {crumb.label}
                      </span>
                      <span className="block max-w-20 truncate md:hidden">
                        {crumb.short}
                      </span>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className={hidden} />
                </Fragment>
              );
            })}
            <BreadcrumbItem className="min-w-24">
              <h1 className="text-foreground truncate font-medium">{title}</h1>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {connected ? null : <Disconnected />}
        <SearchButton />
        {actions === undefined ? null : (
          <div className="flex shrink-0 items-center gap-2 md:gap-1">
            {actions}
          </div>
        )}
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
        {children}
      </div>
    </>
  );
};

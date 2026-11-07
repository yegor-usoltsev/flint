import { cn } from "cn";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { Fragment, use, useRef } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";

import { useOpenPalette } from "~/components/command-palette";
import { PanelToggle } from "~/components/panel-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger, useSidebar } from "~/components/ui/sidebar";
import { Skeleton } from "~/components/ui/skeleton";
import { PagePane } from "~/lib/page-pane";

export interface Crumb {
  label: string;
  link: ReactElement;
  short?: string;
}

const noCrumbs: Crumb[] = [];

const SearchButton = () => {
  const openPalette = useOpenPalette();

  if (openPalette === null) {
    return null;
  }

  return (
    <Button
      aria-keyshortcuts="Control+K Meta+K"
      aria-label="Search"
      className="md:hidden"
      onClick={openPalette}
      size="icon"
      variant="ghost"
    >
      <SearchIcon />
    </Button>
  );
};

const PageTitle = ({
  context,
  header,
  switcher,
  title,
}: {
  context?: string;
  header: RefObject<HTMLElement | null>;
  switcher?: ReactNode;
  title: string;
}) => {
  const { isMobile, open } = useSidebar();

  if (switcher === undefined || (open && !isMobile)) {
    return (
      <h1 className="text-foreground flex min-w-0 font-medium">
        <span className="truncate">{title}</span>
      </h1>
    );
  }

  return (
    <h1 className="text-foreground flex min-w-0 font-medium">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="-ml-2.5 min-w-0 shrink max-md:h-10"
              variant="ghost"
            />
          }
        >
          <span className="flex min-w-0 flex-col items-start">
            {context === undefined ? null : (
              <span className="text-muted-foreground max-w-full truncate text-xs font-normal md:hidden">
                {context}
              </span>
            )}
            <span className="max-w-full truncate">{title}</span>
          </span>
          <ChevronDownIcon
            className="text-muted-foreground"
            data-icon="inline-end"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          anchor={isMobile ? header : undefined}
          className={isMobile ? undefined : "max-h-96 w-64"}
          sheet={isMobile}
          sideOffset={isMobile ? 0 : undefined}
        >
          {switcher}
        </DropdownMenuContent>
      </DropdownMenu>
    </h1>
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
  bounded = false,
  children,
  className,
  crumbs = noCrumbs,
  switcher,
  title,
}: {
  actions?: ReactNode;
  bounded?: boolean;
  children: ReactNode;
  className?: string;
  crumbs?: Crumb[];
  switcher?: ReactNode;
  title: string;
}) => {
  const pane = use(PagePane);
  const header = useRef<HTMLElement>(null);
  const context = crumbs.at(-1);

  return (
    <>
      <header className="flex h-11 shrink-0 border-b" ref={header}>
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-3",
            bounded && "max-w-list mx-auto"
          )}
        >
          {pane === "detail" ? null : (
            <>
              <SidebarTrigger className="-ml-1" />
              <Separator
                className="mr-1 data-vertical:h-4 data-vertical:self-center"
                orientation="vertical"
              />
            </>
          )}
          <Breadcrumb
            aria-label={pane === "detail" ? "Page breadcrumb" : "breadcrumb"}
            className="@container min-w-0 flex-1"
          >
            <BreadcrumbList className="flex-nowrap max-md:flex-col max-md:items-start">
              {crumbs.map((crumb, index) => {
                const hidden = cn(
                  "max-md:hidden",
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
                        <span className="block max-w-60 truncate">
                          {crumb.label}
                        </span>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className={hidden} />
                  </Fragment>
                );
              })}
              {context === undefined || switcher !== undefined ? null : (
                <BreadcrumbItem className="max-w-full md:hidden">
                  <BreadcrumbLink
                    className="hit-area relative min-w-0"
                    render={context.link}
                  >
                    <span className="block truncate text-xs">
                      {context.short ?? context.label}
                    </span>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              )}
              <BreadcrumbItem
                className={cn(
                  "min-w-24 max-md:max-w-full",
                  switcher === undefined && "max-md:-mt-1"
                )}
              >
                <PageTitle
                  context={context?.short ?? context?.label}
                  header={header}
                  switcher={switcher}
                  title={title}
                />
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <SearchButton />
          {actions === undefined ? null : (
            <div className="flex shrink-0 items-center gap-2 md:gap-1">
              {actions}
            </div>
          )}
          {pane === "list" ? null : <PanelToggle />}
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
        {children}
      </div>
    </>
  );
};

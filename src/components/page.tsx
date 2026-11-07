import { cn } from "cn";
import { ChevronDownIcon, ChevronLeftIcon, SearchIcon } from "lucide-react";
import { Fragment, use, useRef } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";

import { useOpenPalette } from "~/components/command-palette";
import { Hint } from "~/components/issue-parts";
import { PanelToggle } from "~/components/panel-toggle";
import { SyncText, useSyncShown } from "~/components/sync-status";
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

const ContextLine = ({
  context,
  only,
  syncing,
}: {
  context?: string;
  only: boolean;
  syncing: boolean;
}) => {
  if (syncing) {
    return <SyncText className="max-w-full md:hidden" />;
  }

  return context === undefined ? null : (
    <span
      className={cn(
        "max-w-full truncate md:hidden",
        only ? "text-heading" : "text-muted-foreground text-xs font-normal"
      )}
    >
      {context}
    </span>
  );
};

const PageTitle = ({
  bodyTitle,
  context,
  header,
  switcher,
  title,
}: {
  bodyTitle: boolean;
  context?: string;
  header: RefObject<HTMLElement | null>;
  switcher?: ReactNode;
  title: string;
}) => {
  const { isMobile, open } = useSidebar();
  const syncing = useSyncShown() !== null;
  const only = bodyTitle && context !== undefined && !syncing;

  if (switcher === undefined || (open && !isMobile)) {
    return (
      <h1 className="text-foreground flex min-w-0 font-medium">
        <span className="max-md:text-heading truncate">{title}</span>
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
            <ContextLine context={context} only={only} syncing={syncing} />
            <span
              className={cn(
                "max-md:text-heading max-w-full truncate",
                only && "max-md:sr-only"
              )}
            >
              {title}
            </span>
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

const PhoneContext = ({
  context,
  syncing,
}: {
  context?: Crumb;
  syncing: boolean;
}) => {
  if (syncing) {
    return (
      <BreadcrumbItem className="min-w-6 shrink-[100] md:hidden">
        <SyncText />
      </BreadcrumbItem>
    );
  }

  return context === undefined ? null : (
    <>
      <BreadcrumbItem className="min-w-6 shrink-[100] md:hidden">
        <BreadcrumbLink
          className="hit-area relative flex min-w-0 items-center"
          render={context.link}
        >
          <ChevronLeftIcon
            aria-hidden
            className="mr-0.5 -ml-1 size-4 shrink-0"
          />
          <span className="truncate">{context.short ?? context.label}</span>
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="md:hidden" />
    </>
  );
};

export const Page = ({
  actions,
  bodyTitle = false,
  bounded = false,
  children,
  className,
  crumbs = noCrumbs,
  switcher,
  title,
}: {
  actions?: ReactNode;
  bodyTitle?: boolean;
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
  const syncing = useSyncShown() !== null;

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
              <Hint hotkey={{ keys: "[" }} label="Toggle sidebar">
                <SidebarTrigger className="-ml-1" />
              </Hint>
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
            <BreadcrumbList className="flex-nowrap">
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
              {switcher === undefined ? (
                <PhoneContext context={context} syncing={syncing} />
              ) : null}
              <BreadcrumbItem className="min-w-12 max-md:max-w-full md:min-w-24">
                <PageTitle
                  bodyTitle={bodyTitle}
                  context={context?.short ?? context?.label}
                  header={header}
                  switcher={switcher}
                  title={title}
                />
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {pane === "list" ? null : (
            <SyncText className="shrink-0 max-md:hidden" />
          )}
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

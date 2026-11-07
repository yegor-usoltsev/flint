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

const TitleText = ({ short, title }: { short?: string; title: string }) => {
  if (short === undefined) {
    return <span className="truncate">{title}</span>;
  }

  return (
    <>
      <span className="truncate md:hidden">{short}</span>
      <span className="truncate max-md:sr-only">{title}</span>
    </>
  );
};

const PageTitle = ({
  header,
  short,
  switcher,
  title,
}: {
  header: RefObject<HTMLElement | null>;
  short?: string;
  switcher?: ReactNode;
  title: string;
}) => {
  const { isMobile, open } = useSidebar();

  if (switcher === undefined || (open && !isMobile)) {
    return (
      <h1 className="text-foreground flex min-w-0 font-medium">
        <TitleText short={short} title={title} />
      </h1>
    );
  }

  return (
    <h1 className="text-foreground flex min-w-0 font-medium">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button className="-ml-2.5 min-w-0 shrink" variant="ghost" />}
        >
          <TitleText short={short} title={title} />
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
  children,
  className,
  crumbs = noCrumbs,
  short,
  switcher,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  crumbs?: Crumb[];
  short?: string;
  switcher?: ReactNode;
  title: string;
}) => {
  const pane = use(PagePane);
  const header = useRef<HTMLElement>(null);
  const scope = crumbs.findLast((crumb) => crumb.short !== undefined);

  return (
    <>
      <header
        className="flex h-11 shrink-0 items-center gap-2 border-b px-3"
        ref={header}
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
          <BreadcrumbList className="flex-nowrap">
            {crumbs.map((crumb, index) => {
              const hidden = cn(
                (crumb !== scope || switcher !== undefined) && "max-md:hidden",
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
              <PageTitle
                header={header}
                short={short}
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
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
        {children}
      </div>
    </>
  );
};

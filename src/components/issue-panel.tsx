import { useQueryClient } from "@tanstack/react-query";
import {
  useLocation,
  useMatch,
  useNavigate,
  useParams,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { cn } from "cn";
import { PanelRightIcon } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import {
  clampWidth,
  openPanel,
  panelAvailable,
  panelMin,
  panelVisible,
  setPanelSpace,
  setPanelWidth,
  showFirstRow,
  syncPanelIssue,
  returnFocusToList,
  usePanel,
  writePanelUrl,
} from "~/lib/issue-panel";
import { useProjectView } from "~/lib/issue-view";
import type { IssueOrigin } from "~/lib/issue-view";
import { useCommands } from "~/lib/use-hotkey";

const IssuePanelContent = lazy(async () => {
  const { IssuePanelContent: Content } =
    await import("~/components/issue-detail");

  return { default: Content };
});

const withoutIssue = <Search extends { issue?: string }>(search: Search) => {
  const filters = { ...search };

  delete filters.issue;

  return filters;
};

const usePanelOrigin = (): IssueOrigin | undefined => {
  const project = useMatch({
    from: "/$slug/project/$key",
    shouldThrow: false,
  });

  const mine = useMatch({ from: "/$slug/my-issues", shouldThrow: false });
  const view = useProjectView(project?.params.key ?? "");

  if (project !== undefined) {
    return {
      projectKey: project.params.key.toUpperCase(),
      search: withoutIssue(project.search),
      view,
    };
  }

  return mine === undefined ? undefined : { view: "mine" };
};

const Pending = () => (
  <div aria-busy className="flex flex-col gap-3 p-4">
    <Skeleton className="h-6 w-1/2" />
    <Skeleton className="h-4 w-full" />
  </div>
);

const PanelBody = ({
  issueKey,
  panel,
}: {
  issueKey: string | null;
  panel: RefObject<HTMLElement | null>;
}) => {
  const queryClient = useQueryClient();
  const origin = usePanelOrigin();

  useCommands([
    {
      hotkey: { keys: "escape" },
      id: "panel-escape",
      run: () => {
        returnFocusToList(queryClient);
      },
      when: () => panel.current?.contains(document.activeElement) === true,
    },
  ]);

  if (issueKey === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PanelRightIcon />
          </EmptyMedia>
          <EmptyTitle>
            <h2>Select an issue</h2>
          </EmptyTitle>
          <EmptyDescription>
            {origin === undefined
              ? "Click an issue mention to see it here."
              : "Click an issue, or move with J and K, to see it here."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Suspense fallback={<Pending />}>
      <IssuePanelContent issueKey={issueKey} origin={origin} />
    </Suspense>
  );
};

const step = 32;

const ResizeHandle = ({ space, width }: { space: number; width: number }) => {
  const resize = (next: number) => {
    setPanelWidth(clampWidth(next, space));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    const aside = handle.closest("aside");

    if (event.button !== 0 || aside === null) {
      return;
    }

    event.preventDefault();

    const start = event.clientX;
    let next = width;

    handle.setPointerCapture(event.pointerId);
    aside.dataset["resizing"] = "";

    const move = (moved: globalThis.PointerEvent) => {
      next = clampWidth(width + start - moved.clientX, space);
      aside.style.setProperty("--panel-width", `${next}px`);
    };

    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      delete aside.dataset["resizing"];
      setPanelWidth(next);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      resize(width + (event.key === "ArrowLeft" ? step : -step));
    }
  };

  return (
    <div
      aria-label="Resize issue panel"
      aria-orientation="vertical"
      aria-valuemax={clampWidth(space, space)}
      aria-valuemin={Math.round(panelMin())}
      aria-valuenow={width}
      className="hover:bg-ring/40 focus-visible:bg-ring absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none outline-none"
      onDoubleClick={() => {
        setPanelWidth(null);
      }}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A focusable separator is the ARIA splitter pattern; an hr cannot take focus or pointer drags.
      role="separator"
      tabIndex={0}
    />
  );
};

const useAvailableSpace = (
  host: RefObject<HTMLDivElement | null>,
  enabled: boolean
) => {
  const [space, setSpace] = useState(0);

  useLayoutEffect(() => {
    const element = host.current;

    const measure = (width: number) => {
      setSpace(width);
      setPanelSpace(width, enabled);
    };

    const observer = new ResizeObserver(([entry]) => {
      measure(entry?.contentRect.width ?? 0);
    });

    if (element !== null) {
      measure(element.clientWidth);
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      setPanelSpace(0, false);
    };
  }, [enabled, host]);

  return space;
};

const useSlide = (shown: boolean) => {
  const [animate, setAnimate] = useState(false);
  const [slide, setSlide] = useState({ moving: false, mounted: shown, shown });

  if (slide.shown !== shown) {
    setSlide({ moving: animate, mounted: animate || shown, shown });
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setAnimate(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const { moving, shown: target } = slide;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (moving) {
        setSlide((last) =>
          last.shown === target
            ? { ...last, moving: false, mounted: last.shown }
            : last
        );
      }
    }, 220);

    return () => {
      clearTimeout(timer);
    };
  }, [moving, target]);

  return slide;
};

const useFirstRow = (
  host: RefObject<HTMLDivElement | null>,
  active: boolean
) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const element = host.current;

    const observer = new MutationObserver(() => {
      if (showFirstRow(queryClient)) {
        observer.disconnect();
      }
    });

    if (active && element !== null && !showFirstRow(queryClient)) {
      observer.observe(element, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    }

    return () => {
      observer.disconnect();
    };
  }, [active, host, queryClient]);
};

const useLinkedIssue = ({
  active,
  issue,
  space,
}: {
  active: boolean;
  issue: string | null;
  space: number;
}) => {
  const navigate = useNavigate();
  const origin = usePanelOrigin();
  const handled = useRef<string | null>(null);

  const slug = useParams({
    select: (params) => params.slug ?? "",
    strict: false,
  });

  useEffect(() => {
    if (issue === null) {
      handled.current = null;
    }

    if (space === 0 || issue === null || handled.current === issue) {
      return;
    }

    handled.current = issue;

    if (!active) {
      return;
    }

    if (panelAvailable()) {
      openPanel(issue);
    } else {
      void navigate({
        params: { issueKey: issue, slug },
        replace: true,
        state: { from: origin, full: true },
        to: "/$slug/issue/$issueKey",
      });
    }
  }, [active, issue, navigate, origin, slug, space]);
};

export const IssuePanelHost = ({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const href = useLocation({ select: (location) => location.href });

  const path = useRouterState({
    select: (router) => router.resolvedLocation?.pathname ?? "",
  });

  const scope = useLocation({
    select: (location) =>
      /^\/[^/]+\/wiki(?:\/|$)/u.test(location.pathname) ? "wiki" : "list",
  });

  const slug = useParams({
    select: (params) => params.slug ?? "",
    strict: false,
  });

  const issue = useSearch({
    select: (search) => search.issue ?? null,
    strict: false,
  });

  const state = usePanel();
  const space = useAvailableSpace(host, enabled);
  const shown = enabled && panelVisible(state);
  const slide = useSlide(shown);
  const origin = usePanelOrigin();
  const width = clampWidth(state.width, space, origin?.view !== "board");
  const [last, setLast] = useState(state.issue);

  if (state.issue !== null && state.issue !== last) {
    setLast(state.issue);
  }

  useEffect(() => {
    syncPanelIssue(issue, slug, scope, path);
  }, [issue, path, scope, slug]);

  const waiting = state.open && state.available && state.issue === null;

  useLinkedIssue({ active: enabled, issue, space });

  useFirstRow(host, enabled && scope === "list" && waiting);

  useEffect(() => {
    if (enabled && href !== "" && slug !== "") {
      writePanelUrl();
    }
  }, [enabled, href, slug]);

  return (
    <div className="flex min-h-0 flex-1" ref={host}>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {enabled ? (
        <aside
          aria-label="Issue panel"
          className={cn(
            "flex shrink-0 justify-end overflow-hidden data-resizing:transition-none",
            shown ? "w-(--panel-width) border-l" : "w-0",
            slide.moving &&
              "transition-all duration-200 ease-out motion-reduce:transition-none"
          )}
          inert={!shown}
          onKeyDownCapture={(event) => {
            if (event.key === "Escape") {
              requestAnimationFrame(() => {
                if (document.activeElement === document.body) {
                  returnFocusToList(queryClient);
                }
              });
            }
          }}
          ref={panel}
          style={{ "--panel-width": `${width}px` }}
        >
          <div className="relative flex w-(--panel-width) shrink-0 flex-col">
            {shown ? <ResizeHandle space={space} width={width} /> : null}
            {slide.mounted ? (
              <PanelBody issueKey={shown ? state.issue : last} panel={panel} />
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
};

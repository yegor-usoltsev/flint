import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useMatch, useSearch } from "@tanstack/react-router";
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
import { hasRows, moveFocus } from "~/lib/issue-focus";
import {
  clampWidth,
  focusPanelRow,
  listMin,
  panelMin,
  setPanelAvailable,
  setPanelWidth,
  syncPanelIssue,
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
        if (focusPanelRow(queryClient)) {
          return;
        }

        if (hasRows()) {
          moveFocus(1);
        } else if (document.activeElement instanceof HTMLElement) {
          // oxlint-disable-next-line github/no-blur -- Escape leaves the panel; no list row exists to take the focus.
          document.activeElement.blur();
        }
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
      aria-valuemin={panelMin}
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
      setPanelAvailable(enabled && width >= panelMin + listMin);
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
      setPanelAvailable(false);
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

  const { moving } = slide;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (moving) {
        setSlide((last) => ({ ...last, moving: false, mounted: last.shown }));
      }
    }, 220);

    return () => {
      clearTimeout(timer);
    };
  }, [moving]);

  return slide;
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
  const href = useLocation({ select: (location) => location.href });

  const issue = useSearch({
    select: (search) => search.issue ?? null,
    strict: false,
  });

  const state = usePanel();
  const space = useAvailableSpace(host, enabled);
  const shown = enabled && state.open && state.available;
  const slide = useSlide(shown);
  const width = clampWidth(state.width, space);

  useEffect(() => {
    if (issue !== null) {
      syncPanelIssue(issue);
    }
  }, [issue]);

  useEffect(() => {
    if (enabled && href !== "") {
      writePanelUrl();
    }
  }, [enabled, href]);

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
          ref={panel}
          style={{ "--panel-width": `${width}px` }}
        >
          <div className="relative flex w-(--panel-width) shrink-0 flex-col">
            {shown ? <ResizeHandle space={space} width={width} /> : null}
            {slide.mounted ? (
              <PanelBody issueKey={state.issue} panel={panel} />
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
};

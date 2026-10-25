import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { formatBytes } from "~/lib/uploads";

const viewerKinds = ["audio", "file", "image", "video"] as const;

export interface ViewerItem {
  kind: (typeof viewerKinds)[number];
  name: string;
  size?: number;
  src: string;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface Gesture {
  distance: number;
  middle: Point;
  moved: Point;
  view: View;
}

const rest: View = { scale: 1, x: 0, y: 0 };

const maxScale = 8;

const zoomSteps = new Map([
  ["+", 1.5],
  ["-", 1 / 1.5],
  ["=", 1.5],
]);

const steps = new Map([
  ["ArrowDown", 1],
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
  ["ArrowUp", -1],
]);

const control =
  "hit-area relative flex size-9 shrink-0 items-center justify-center rounded-full text-white outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-5";

const clamp = (value: number, limit: number) =>
  Math.min(Math.max(value, -limit), limit);

const clampView = (
  view: View,
  stage: HTMLElement | null,
  media: HTMLElement | null
): View => {
  const scale = Math.min(Math.max(view.scale, 1), maxScale);

  if (scale === 1 || stage === null || media === null) {
    return rest;
  }

  const width = (media.offsetWidth * scale - stage.clientWidth) / 2;
  const height = (media.offsetHeight * scale - stage.clientHeight) / 2;

  return {
    scale,
    x: clamp(view.x, Math.max(width, 0)),
    y: clamp(view.y, Math.max(height, 0)),
  };
};

const zoomAt = (view: View, point: Point, scale: number): View => {
  const ratio = Math.min(Math.max(scale, 1), maxScale) / view.scale;

  return {
    scale: view.scale * ratio,
    x: point.x - ratio * (point.x - view.x),
    y: point.y - ratio * (point.y - view.y),
  };
};

const spread = ([a, b]: Point[]) =>
  a === undefined || b === undefined ? 0 : Math.hypot(a.x - b.x, a.y - b.y);

const middle = (points: Point[]): Point => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

const swipeStep = (gesture: Gesture | null) => {
  const { x, y } = gesture?.moved ?? rest;

  const swiped =
    gesture?.view.scale === 1 && Math.abs(x) > 60 && Math.abs(x) > Math.abs(y);

  if (!swiped) {
    return 0;
  }

  return x < 0 ? 1 : -1;
};

const useZoom = ({
  enabled,
  media,
  onSwipe,
  shown,
  stage,
}: {
  enabled: boolean;
  media: HTMLElement | null;
  onSwipe: (step: number) => void;
  shown: number | null;
  stage: HTMLElement | null;
}) => {
  const [view, setView] = useState(rest);
  const [item, setItem] = useState(shown);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);

  if (item !== shown) {
    setItem(shown);
    setView(rest);
  }

  const update = (next: View) => {
    setView(clampView(next, stage, media));
  };

  const local = (event: { clientX: number; clientY: number }): Point => {
    const box = stage?.getBoundingClientRect();

    return box === undefined
      ? rest
      : {
          x: event.clientX - box.left - box.width / 2,
          y: event.clientY - box.top - box.height / 2,
        };
  };

  const begin = () => {
    const points = [...pointers.current.values()];

    gesture.current = {
      distance: spread(points),
      middle: middle(points),
      moved: rest,
      view,
    };
  };

  const onWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    update(
      zoomAt(view, local(event), view.scale * Math.exp(-event.deltaY / 300))
    );
  });

  useEffect(() => {
    const target = enabled ? stage : null;

    const listener = (event: WheelEvent) => {
      onWheel(event);
    };

    // oxlint-disable-next-line github/require-passive-events -- The wheel zooms the image, so it must cancel the page scroll.
    target?.addEventListener("wheel", listener, { passive: false });

    return () => {
      target?.removeEventListener("wheel", listener);
    };
  }, [enabled, stage]);

  return {
    keys: (key: string) => {
      const step = zoomSteps.get(key);

      if (key === "0") {
        update(rest);
      } else if (step !== undefined) {
        update(zoomAt(view, rest, view.scale * step));
      }

      return key === "0" || step !== undefined;
    },
    pointer: {
      onDoubleClick: (event: { clientX: number; clientY: number }) => {
        if (enabled) {
          update(view.scale > 1 ? rest : zoomAt(view, local(event), 2.5));
        }
      },
      onPointerCancel: (event: PointerEvent) => {
        pointers.current.delete(event.pointerId);
        gesture.current = null;
      },
      onPointerDown: (event: PointerEvent) => {
        if (enabled) {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, local(event));
          begin();
        }
      },
      onPointerMove: (event: PointerEvent) => {
        const start = gesture.current;

        if (start === null || !pointers.current.has(event.pointerId)) {
          return;
        }

        pointers.current.set(event.pointerId, local(event));

        const points = [...pointers.current.values()];
        const center = middle(points);

        const moved = {
          x: center.x - start.middle.x,
          y: center.y - start.middle.y,
        };

        start.moved = moved;

        if (points.length > 1 && start.distance > 0) {
          const scale = (start.view.scale * spread(points)) / start.distance;
          const zoomed = zoomAt(start.view, start.middle, scale);

          update({ ...zoomed, x: zoomed.x + moved.x, y: zoomed.y + moved.y });
        } else if (start.view.scale > 1) {
          update({
            ...start.view,
            x: start.view.x + moved.x,
            y: start.view.y + moved.y,
          });
        }
      },
      onPointerUp: (event: PointerEvent) => {
        const start = gesture.current;

        pointers.current.delete(event.pointerId);

        if (pointers.current.size > 0) {
          begin();

          return;
        }

        gesture.current = null;

        const step = swipeStep(start);

        if (step !== 0) {
          onSwipe(step);
        }
      },
    },
    view,
  };
};

const FileCard = ({ item }: { item: ViewerItem }) => (
  <div className="flex w-72 max-w-full flex-col items-center gap-3 rounded-xl bg-white/10 p-6 text-center">
    <FileIcon aria-hidden className="size-10 text-white/70" />
    <span className="w-full truncate font-medium">{item.name}</span>
    {item.size === undefined ? null : (
      <span className="text-white/70">{formatBytes(item.size)}</span>
    )}
    <a
      className="hit-area relative flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 font-medium text-black outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black [&_svg]:size-4"
      download={item.name}
      href={item.src}
    >
      <DownloadIcon aria-hidden />
      Download
    </a>
  </div>
);

const Slide = ({
  item,
  media,
  onFit,
  view,
}: {
  item: ViewerItem;
  media: (element: HTMLImageElement | null) => void;
  onFit: (fit: number) => void;
  view: View;
}) => {
  if (item.kind === "image") {
    return (
      <img
        alt={item.name}
        className="max-h-full max-w-full translate-x-(--zoom-x) translate-y-(--zoom-y) scale-(--zoom) object-contain select-none"
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget;

          onFit(image.offsetWidth / Math.max(image.naturalWidth, 1));
        }}
        ref={media}
        src={item.src}
        style={{
          "--zoom": view.scale,
          "--zoom-x": `${view.x}px`,
          "--zoom-y": `${view.y}px`,
        }}
      />
    );
  }

  if (item.kind === "video") {
    return (
      <video autoPlay className="max-h-full max-w-full" controls src={item.src}>
        <track kind="captions" />
      </video>
    );
  }

  if (item.kind === "audio") {
    return (
      <div className="flex w-md max-w-full flex-col items-center gap-4">
        <span className="w-full truncate text-center font-medium">
          {item.name}
        </span>
        <audio autoPlay className="w-full" controls src={item.src}>
          <track kind="captions" />
        </audio>
      </div>
    );
  }

  return <FileCard item={item} />;
};

export const MediaViewer = ({
  index,
  items,
  onIndex,
}: {
  index: number | null;
  items: ViewerItem[];
  onIndex: (index: number | null) => void;
}) => {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [media, setMedia] = useState<HTMLImageElement | null>(null);
  const count = items.length;
  const item = index === null ? undefined : items[index];

  const go = (step: number) => {
    if (index !== null && count > 1) {
      onIndex((index + step + count) % count);
    }
  };

  const zoomable = item?.kind === "image";
  const [fit, setFit] = useState<{ fit: number; src: string } | null>(null);

  const zoom = useZoom({
    enabled: zoomable,
    media,
    onSwipe: go,
    shown: index,
    stage,
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;

    const navigates =
      plain && !event.shiftKey && !(event.target instanceof HTMLMediaElement);

    const step = navigates ? steps.get(event.key) : undefined;

    if (step !== undefined) {
      event.preventDefault();
      go(step);
    } else if (zoomable && plain && zoom.keys(event.key)) {
      event.preventDefault();
    }
  };

  return (
    <DialogPrimitive.Root
      onOpenChange={(open) => {
        if (!open) {
          onIndex(null);
        }
      }}
      open={item !== undefined}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex flex-col text-sm text-white transition-opacity duration-150 ease-out outline-none data-ending-style:opacity-0 data-starting-style:opacity-0"
          onKeyDown={onKeyDown}
        >
          {item === undefined ? null : (
            <>
              <header className="flex shrink-0 items-center gap-1 py-2 pr-2 pl-4">
                <DialogPrimitive.Title className="sr-only">
                  {item.name}
                </DialogPrimitive.Title>
                <span className="flex-1 text-white/70 tabular-nums">
                  {zoomable && fit?.src === item.src
                    ? `${Math.round(fit.fit * zoom.view.scale * 100)}%`
                    : null}
                  {count > 1 ? (
                    <span className="ml-3">
                      {(index ?? 0) + 1} / {count}
                    </span>
                  ) : null}
                </span>
                <a
                  aria-label={`Download ${item.name}`}
                  className={control}
                  download={item.name}
                  href={item.src}
                >
                  <DownloadIcon aria-hidden />
                </a>
                {count > 1 ? (
                  <>
                    <button
                      aria-label="Previous"
                      className={control}
                      onClick={() => {
                        go(-1);
                      }}
                      type="button"
                    >
                      <ChevronLeftIcon aria-hidden />
                    </button>
                    <button
                      aria-label="Next"
                      className={control}
                      onClick={() => {
                        go(1);
                      }}
                      type="button"
                    >
                      <ChevronRightIcon aria-hidden />
                    </button>
                  </>
                ) : null}
                <DialogPrimitive.Close aria-label="Close" className={control}>
                  <XIcon aria-hidden />
                </DialogPrimitive.Close>
              </header>
              <div
                className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden p-4"
                ref={setStage}
                {...zoom.pointer}
              >
                <Slide
                  item={item}
                  media={setMedia}
                  onFit={(value) => {
                    setFit({ fit: value, src: item.src });
                  }}
                  view={zoom.view}
                />
              </div>
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

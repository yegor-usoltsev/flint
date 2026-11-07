import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { DownloadIcon, FileIcon } from "lucide-react";
import PhotoSwipe from "photoswipe";
import type { SlideData } from "photoswipe";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

import { formatBytes } from "~/lib/uploads";

const viewerKinds = ["audio", "file", "image", "video"] as const;

export interface ViewerItem {
  element?: HTMLImageElement;
  kind: (typeof viewerKinds)[number];
  name: string;
  size?: number;
  src: string;
}

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

const handleKey = (pswp: PhotoSwipe, key: string) => {
  const step = steps.get(key);
  const slide = pswp.currSlide;
  const zoom = key === "0" ? 1 : zoomSteps.get(key);

  if (step !== undefined) {
    pswp.goTo(pswp.potentialIndex + step);
  } else if (zoom !== undefined && slide?.isZoomable() === true) {
    const { initial, max, min } = slide.zoomLevels;
    const level = key === "0" ? initial : slide.currZoomLevel * zoom;

    slide.zoomTo(
      Math.min(Math.max(level, min), max),
      undefined,
      pswp.options.zoomAnimationDuration
    );
  } else {
    return false;
  }

  return true;
};

const downloadIcon =
  '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path d="M16 7v12m-5-5 5 5 5-5M8 21v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" style="fill:none;stroke:var(--pswp-icon-color);stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/></svg>';

const sizes = new Map<string, { height: number; width: number }>();

const slideData = (item: ViewerItem): SlideData => {
  if (item.kind !== "image") {
    return { type: item.kind };
  }

  const { element } = item;

  const size =
    element !== undefined && element.naturalWidth > 0
      ? { height: element.naturalHeight, width: element.naturalWidth }
      : sizes.get(item.src);

  return {
    alt: item.name,
    element,
    msrc: element?.currentSrc,
    src: item.src,
    ...size,
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

const Slide = ({ active, item }: { active: boolean; item: ViewerItem }) => {
  const media = (element: HTMLMediaElement | null) => {
    if (!active) {
      element?.pause();
    } else if (element?.paused === true) {
      element.play().catch(() => null);
    }
  };

  if (item.kind === "video") {
    return (
      <video
        className="max-h-full max-w-full"
        controls
        ref={media}
        src={item.src}
      >
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
        <audio className="w-full" controls ref={media} src={item.src}>
          <track kind="captions" />
        </audio>
      </div>
    );
  }

  return <FileCard item={item} />;
};

interface ViewerProps {
  index: number | null;
  items: ViewerItem[];
  onIndex: (index: number | null) => void;
}

type Slots = Map<number, HTMLElement>;

const mount = (
  root: HTMLElement,
  props: RefObject<ViewerProps>,
  setSlots: (update: (slots: Slots) => Slots) => void
) => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const at = (index: number) => props.current.items[index];
  let download: HTMLElement | undefined;
  let disposed = false;

  const pswp = new PhotoSwipe({
    appendToEl: root,
    bgOpacity: 1,
    dataSource: [],
    escKey: false,
    index: props.current.index ?? 0,
    returnFocus: false,
    showHideAnimationType: reduced ? "none" : "zoom",
    trapFocus: false,
    wheelToZoom: true,
    zoomAnimationDuration: reduced ? 0 : 333,
  });

  pswp.goTo = (to) => {
    pswp.mainScroll.moveIndexBy(
      pswp.getLoopedIndex(to) - pswp.potentialIndex,
      !reduced
    );
  };

  pswp.addFilter("numItems", () => props.current.items.length);
  pswp.addFilter("itemData", (_, index) => {
    const shown = at(index);

    return shown === undefined ? {} : slideData(shown);
  });

  pswp.on("contentLoad", (event) => {
    const { content } = event;
    const shown = at(content.index);

    if (shown?.kind !== "image") {
      event.preventDefault();

      const slot = document.createElement("div");

      slot.className =
        "absolute flex size-0 items-center justify-center text-sm text-white";
      content.element = slot;
      setSlots((current) => new Map(current).set(content.index, slot));
    } else if (content.width === 0) {
      event.preventDefault();

      const image = new Image();

      image.addEventListener("load", () => {
        sizes.set(shown.src, {
          height: image.naturalHeight || window.innerHeight,
          width: image.naturalWidth || window.innerWidth,
        });

        if (!pswp.isDestroying) {
          pswp.refreshSlideContent(content.index);
        }
      });
      image.addEventListener("error", () => {
        content.onError();
      });
      image.src = shown.src;
    }
  });

  pswp.on("contentDestroy", ({ content }) => {
    setSlots(
      (current) =>
        new Map([...current].filter(([, slot]) => slot !== content.element))
    );
  });

  pswp.on("pointerDown", (event) => {
    const { target } = event.originalEvent;

    if (
      target instanceof Element &&
      target.closest("a, audio, button, video") !== null
    ) {
      event.preventDefault();
    }
  });

  pswp.on("uiRegister", () => {
    pswp.ui?.registerElement({
      html: downloadIcon,
      isButton: true,
      name: "download",
      onInit: (button) => {
        download = button;
      },
      order: 8,
      tagName: "a",
    });
  });

  const sync = () => {
    const shown = at(pswp.currIndex);

    download?.setAttribute("download", shown?.name ?? "");
    download?.setAttribute("href", shown?.src ?? "");
    download?.setAttribute("aria-label", `Download ${shown?.name ?? ""}`);
  };

  pswp.on("change", () => {
    sync();
    props.current.onIndex(pswp.currIndex);
  });

  pswp.on("destroy", () => {
    if (!disposed) {
      props.current.onIndex(null);
    }
  });

  pswp.init();
  pswp.element?.removeAttribute("role");

  return {
    dispose: () => {
      disposed = true;

      if (!pswp.isDestroying) {
        pswp.isDestroying = true;
        pswp.destroy();
      }
    },
    pswp,
    sync,
  };
};

export const MediaViewer = (props: ViewerProps) => {
  const { index, items, onIndex } = props;
  const [slots, setSlots] = useState<Slots>(new Map());
  const viewer = useRef<ReturnType<typeof mount> | null>(null);
  const latest = useRef(props);
  const popup = useRef<HTMLDivElement>(null);
  const item = index === null ? undefined : items[index];

  useEffect(() => {
    const resized = latest.current.items.length !== props.items.length;

    latest.current = props;

    viewer.current?.sync();

    const pswp = viewer.current?.pswp;

    if (resized && pswp !== undefined) {
      const { currIndex } = pswp;

      for (const step of [-1, 1]) {
        const neighbor = pswp.getLoopedIndex(currIndex + step);

        if (neighbor !== currIndex) {
          pswp.refreshSlideContent(neighbor);
        }
      }
    }
  });

  const attach = useCallback((root: HTMLDivElement) => {
    const mounted = mount(root, latest, setSlots);

    viewer.current = mounted;

    return () => {
      viewer.current = null;
      mounted.dispose();
    };
  }, []);

  return (
    <DialogPrimitive.Root
      onOpenChange={(open) => {
        if (open) {
          return;
        }

        if (viewer.current === null) {
          onIndex(null);
        } else {
          viewer.current.pswp.close();
        }
      }}
      open={item !== undefined}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 outline-none"
          initialFocus={popup}
          onKeyDown={(event) => {
            const pswp = viewer.current?.pswp;

            const plain =
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !(event.target instanceof HTMLMediaElement);

            if (plain && pswp !== undefined && handleKey(pswp, event.key)) {
              event.preventDefault();
            }
          }}
          ref={popup}
        >
          <DialogPrimitive.Title className="sr-only">
            {item?.name}
          </DialogPrimitive.Title>
          <div ref={attach} />
          {[...slots].map(([at, element]) => {
            const shown = items[at];

            return shown === undefined
              ? null
              : createPortal(
                  <div className="flex h-svh w-screen shrink-0 items-center justify-center px-4 pt-16 pb-4">
                    <Slide active={at === index} item={shown} />
                  </div>,
                  element,
                  String(at)
                );
          })}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

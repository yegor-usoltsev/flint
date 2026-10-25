import type { Editor, NodeViewRenderer } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Tag } from "~/lib/media-html";

// Browsers read `\` as `/` and drop tabs and newlines, so `/\host` and `/<tab>/host` would load from another origin.
const safeSource = /^(?:https?:\/\/|\/(?![/\\]))[^\\\p{Cc}]*$/iu;

export const isSafeSource = (src: string) => safeSource.test(src);

const ViewAttributesSchema = v.object({
  alt: v.optional(v.nullable(v.string())),
  src: v.nullable(v.string()),
  width: v.optional(v.nullable(v.number())),
});

const setAttributes = (element: HTMLElement, node: ProseMirrorNode) => {
  const parsed = v.parse(ViewAttributesSchema, node.attrs);

  for (const name of ["src", "alt", "width"] as const) {
    const value = parsed[name];

    if (
      value === null ||
      value === undefined ||
      (name === "src" && !isSafeSource(String(value)))
    ) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, String(value));
    }
  }
};

const icons = {
  delete: [
    "M10 11v6",
    "M14 11v6",
    "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
    "M3 6h18",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  ],
  download: [
    "M12 15V3",
    "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    "m7 10 5 5 5-5",
  ],
  expand: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
};

const svg = (paths: string[]) => {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");

  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");

  for (const d of paths) {
    const path = document.createElementNS(namespace, "path");

    path.setAttribute("d", d);
    icon.append(path);
  }

  return icon;
};

const button = (
  name: keyof typeof icons,
  label: string,
  onClick?: () => void
) => {
  const element = document.createElement("button");

  element.type = "button";
  element.className = `media-${name}`;
  element.setAttribute("aria-label", label);
  element.append(svg(icons[name]));

  if (onClick !== undefined) {
    element.addEventListener("click", onClick);
  }

  return element;
};

const download = (src: string) => {
  if (!isSafeSource(src)) {
    return;
  }

  const link = document.createElement("a");

  link.href = src;
  link.download = "";
  link.click();
};

const resizeHandle = (
  side: "left" | "right",
  media: HTMLElement,
  dom: HTMLElement,
  commit: (width: number | null) => void
) => {
  const handle = document.createElement("span");
  const sign = side === "left" ? -1 : 1;

  handle.className = `media-handle media-handle-${side}`;
  handle.setAttribute("aria-hidden", "true");

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const start = media.getBoundingClientRect().width;
    const limit = dom.parentElement?.clientWidth ?? Number.POSITIVE_INFINITY;
    const drag = new AbortController();
    let width = start;

    const move = (next: PointerEvent) => {
      const wanted = start + sign * (next.clientX - startX);

      width = Math.round(Math.min(Math.max(wanted, 48), limit));
      media.style.width = `${width}px`;
    };

    const end = () => {
      drag.abort();
      dom.toggleAttribute("data-resizing", false);
      media.style.width = "";

      if (width !== start) {
        commit(width);
      }
    };

    dom.toggleAttribute("data-resizing", true);
    handle.addEventListener("pointermove", move, drag);
    handle.addEventListener("pointerup", end, drag);
    handle.addEventListener("pointercancel", end, drag);
  });

  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    commit(null);
  });

  return handle;
};

const edit = (
  editor: Editor,
  getPos: () => number | undefined,
  change: (pos: number) => void
) => {
  const pos = getPos();

  if (pos !== undefined && editor.isEditable) {
    change(pos);
  }
};

export const mediaView =
  (tag: Tag): NodeViewRenderer =>
  ({ editor, getPos, node }) => {
    let current = node;
    const dom = document.createElement("div");
    const media = document.createElement(tag);
    const toolbar = document.createElement("div");

    dom.className = "media";
    toolbar.className = "media-toolbar";
    toolbar.contentEditable = "false";

    if (tag === "img") {
      media.setAttribute("draggable", "false");
    } else {
      const captions = document.createElement("track");

      captions.kind = "captions";
      media.setAttribute("controls", "");
      media.setAttribute("preload", "metadata");
      media.append(captions);
    }

    setAttributes(media, current);

    const resize = (width: number | null) => {
      edit(editor, getPos, (pos) => {
        editor.view.dispatch(
          editor.state.tr.setNodeAttribute(pos, "width", width)
        );
      });
    };

    toolbar.append(
      button("expand", "Open in viewer"),
      button("download", "Download", () => {
        download(media.getAttribute("src") ?? "");
      }),
      button("delete", "Delete", () => {
        edit(editor, getPos, (pos) => {
          editor.view.dispatch(
            editor.state.tr.delete(pos, pos + current.nodeSize)
          );
          editor.commands.focus();
        });
      })
    );

    dom.append(media);

    if (tag !== "audio") {
      dom.append(
        toolbar,
        resizeHandle("left", media, dom, resize),
        resizeHandle("right", media, dom, resize)
      );
    }

    return {
      dom,
      ignoreMutation: () => true,
      stopEvent: (event) => {
        const { target } = event;

        if (target instanceof Node && toolbar.contains(target)) {
          return true;
        }

        return (
          tag !== "img" && target === media && !event.type.startsWith("drag")
        );
      },
      update: (next) => {
        if (next.type !== current.type) {
          return false;
        }

        current = next;
        setAttributes(media, current);

        return true;
      },
    };
  };

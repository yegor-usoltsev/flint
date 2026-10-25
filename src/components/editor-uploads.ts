import { Extension, getMarkRange } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import type { Attachment } from "~/lib/api-types";
import { newId } from "~/lib/ids";
import { notifyError } from "~/lib/notify";
import { attachmentMarkdown, mediaKind } from "~/lib/uploads";
import { trackUpload } from "~/lib/use-draft";

export type Uploader = (
  file: File,
  onProgress?: (fraction: number) => void
) => Promise<Attachment>;

export interface UploadTarget {
  append: (markdown: string) => void;
  detached: () => boolean;
  read: () => string;
  upload: Uploader;
  write: (text: string) => void;
}

export const appendMarkdown = (text: string, markdown: string) => {
  const body = text.trimEnd();

  return body === "" ? markdown : `${body}\n\n${markdown}`;
};

const byId = (set: DecorationSet, id: string) => {
  const matches = (spec: { id?: string }) => spec.id === id;

  return set.find(undefined, undefined, matches);
};

interface UploadMeta {
  add?: { element: HTMLElement; id: string; pos: number };
  remove?: string;
}

export interface DraftRef {
  key: string;
  read: () => string;
}

export interface UploadState {
  draft?: DraftRef;
  onChange?: (markdown: string) => void;
  source: boolean;
  value: string;
}

export const createUploadTarget = (
  upload: Uploader,
  state: { current: UploadState }
): UploadTarget => {
  const read = () => state.current.draft?.read() ?? state.current.value;

  const write = (text: string) => {
    state.current.value = text;
    state.current.onChange?.(text);
  };

  return {
    append: (markdown) => {
      write(appendMarkdown(read(), markdown));
    },
    detached: () => state.current.source,
    read,
    upload: async (file, onProgress) => {
      const key = state.current.draft?.key;

      if (key !== undefined) {
        trackUpload(key, 1);
      }

      try {
        return await upload(file, onProgress);
      } finally {
        if (key !== undefined) {
          trackUpload(key, -1);
        }
      }
    },
    write,
  };
};

const uploadsKey = new PluginKey<DecorationSet>("uploads");

const placeholder = (name: string) => {
  const element = document.createElement("span");

  element.className = "upload-chip";
  element.textContent = name;
  element.style.setProperty("--progress", "0%");

  return element;
};

const findPlaceholder = (state: EditorState, id: string) => {
  const set = uploadsKey.getState(state);

  return set === undefined ? null : (byId(set, id)[0]?.from ?? null);
};

const contentFor = (attachment: Attachment): JSONContent => {
  const kind = mediaKind(attachment);

  if (kind === "image") {
    return {
      attrs: { alt: attachment.filename, src: attachment.url },
      type: "image",
    };
  }

  return kind === null
    ? {
        marks: [{ attrs: { href: attachment.url }, type: "link" }],
        text: attachment.filename,
        type: "text",
      }
    : { attrs: { src: attachment.url }, type: kind };
};

const isEmptyBlock = (node: ProseMirrorNode | null | undefined) =>
  node?.isTextblock === true && node.content.size === 0;

const intoEmptyBlock = (state: EditorState, at: number) => {
  const $at = state.doc.resolve(at);

  if (isEmptyBlock($at.nodeAfter)) {
    return at + 1;
  }

  return isEmptyBlock($at.nodeBefore) ? at - 1 : at;
};

// Inserting inside a link's text would put the upload into that link, so it lands after the link instead.
export const outsideLink = (state: EditorState, at: number) => {
  const { link } = state.schema.marks;

  const range =
    link === undefined ? undefined : getMarkRange(state.doc.resolve(at), link);

  return range !== undefined && range.from < at && at < range.to
    ? range.to
    : at;
};

const setMeta = (editor: Editor, meta: UploadMeta) => {
  editor.view.dispatch(editor.state.tr.setMeta(uploadsKey, meta));
};

export const endOf = (editor: Editor) => {
  const { doc } = editor.state;
  const last = doc.lastChild;

  return last?.isTextblock === true && last.content.size === 0
    ? doc.content.size - last.nodeSize + 1
    : doc.content.size;
};

const uploadOne = async (
  editor: Editor,
  file: File,
  pos: number,
  target: UploadTarget
) => {
  const id = newId();
  const element = placeholder(file.name);

  setMeta(editor, { add: { element, id, pos } });

  try {
    const attachment = await target.upload(file, (fraction) => {
      element.style.setProperty("--progress", `${Math.round(fraction * 100)}%`);
    });

    if (editor.isDestroyed || target.detached()) {
      if (!editor.isDestroyed) {
        setMeta(editor, { remove: id });
      }

      target.append(attachmentMarkdown(attachment));

      return;
    }

    const at = findPlaceholder(editor.state, id) ?? endOf(editor);
    const content = contentFor(attachment);

    setMeta(editor, { remove: id });
    editor.commands.insertContentAt(
      intoEmptyBlock(editor.state, outsideLink(editor.state, at)),
      content,
      {
        updateSelection: false,
      }
    );
  } catch (error) {
    if (!editor.isDestroyed) {
      setMeta(editor, { remove: id });
    }

    notifyError(`Could not upload ${file.name}`)(
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

export const uploadInto = (
  editor: Editor,
  files: File[],
  pos: number,
  target: UploadTarget
) => {
  for (const file of files) {
    void uploadOne(editor, file, pos, target);
  }
};

const uploadText = async (
  file: File,
  marker: string,
  { read, upload, write }: TextTarget
) => {
  try {
    const markdown = attachmentMarkdown(await upload(file));
    const text = read();

    write(
      text.includes(marker)
        ? text.replace(marker, markdown)
        : appendMarkdown(text, markdown)
    );
  } catch (error) {
    write(read().replace(marker, ""));
    notifyError(`Could not upload ${file.name}`)(
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

type TextTarget = Pick<UploadTarget, "read" | "upload" | "write">;

export const uploadIntoText = (
  files: File[],
  caret: number,
  target: TextTarget
) => {
  for (const file of files) {
    const marker = `[Uploading ${file.name}…]()`;
    const text = target.read();
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const lead = before === "" || before.endsWith("\n") ? "" : "\n";
    const trail = after === "" || after.startsWith("\n") ? "" : "\n";

    target.write(`${before}${lead}${marker}${trail}${after}`);
    void uploadText(file, marker, target);
  }
};

const filesOf = (data: DataTransfer | null) => [...(data?.files ?? [])];

export const Uploads = Extension.create<{
  target: () => UploadTarget | null;
}>({
  addOptions: () => ({ target: () => null }),
  addProseMirrorPlugins() {
    const { editor, options } = this;

    return [
      new Plugin<DecorationSet>({
        key: uploadsKey,
        props: {
          decorations: (state) => uploadsKey.getState(state),
          handleDrop: (view, event) => {
            const files = filesOf(event.dataTransfer);
            const target = options.target();

            if (files.length === 0 || target === null) {
              return false;
            }

            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })?.pos;

            event.preventDefault();
            uploadInto(editor, files, pos ?? view.state.selection.to, target);

            return true;
          },
          handlePaste: (view, event) => {
            const files = filesOf(event.clipboardData);
            const target = options.target();

            if (files.length === 0 || target === null) {
              return false;
            }

            uploadInto(editor, files, view.state.selection.to, target);

            return true;
          },
        },
        state: {
          apply: (tr, set) => {
            // oxlint-disable-next-line unicorn/no-array-method-this-argument -- DecorationSet.map takes a mapping and a document, not a thisArg.
            const mapped = set.map(tr.mapping, tr.doc);
            // SAFETY: only this module sets the uploads meta.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ProseMirror types metadata as any.
            const meta = tr.getMeta(uploadsKey) as UploadMeta | undefined;

            if (meta?.add !== undefined) {
              const { element, id, pos } = meta.add;

              return mapped.add(tr.doc, [
                Decoration.widget(pos, element, { id }),
              ]);
            }

            if (meta?.remove !== undefined) {
              const { remove } = meta;

              return mapped.remove(byId(mapped, remove));
            }

            return mapped;
          },
          init: () => DecorationSet.empty,
        },
      }),
    ];
  },
  name: "uploads",
});

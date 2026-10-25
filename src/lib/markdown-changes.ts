import type { JSONContent } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";

import { atomize } from "~/lib/markdown-mentions";

export const withoutTrailingLines = (markdown: string) => {
  let end = markdown.length;

  while (markdown[end - 1] === "\n") {
    end -= 1;
  }

  return markdown.slice(0, end);
};

export const serializeState = (
  state: EditorState,
  manager: MarkdownManager
) => {
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- ProseMirror types Node.toJSON as any; it is the JSONContent that Tiptap's getJSON returns.
  const json: JSONContent = state.doc.toJSON();

  return withoutTrailingLines(manager.serialize(json));
};

export const normalizeMarkdown = (
  state: EditorState,
  manager: MarkdownManager,
  markdown: string
) => {
  const doc = state.schema.nodeFromJSON(manager.parse(markdown));

  const { state: next } = state.applyTransaction(
    state.tr.replaceWith(0, state.doc.content.size, doc.content)
  );

  return serializeState(next, manager);
};

// The caret keeps its position in the document, so the new content gets its chips before the selection is restored; atomizing afterwards would shift it.
export const replaceMarkdown = (
  state: EditorState,
  manager: MarkdownManager,
  markdown: string,
  pattern: RegExp | null
) => {
  const { from, to } = state.selection;
  const doc = state.schema.nodeFromJSON(manager.parse(markdown));

  const tr = atomize(
    state.tr.replaceWith(0, state.doc.content.size, doc.content),
    pattern
  );

  const end = tr.doc.content.size;

  return tr
    .setSelection(
      TextSelection.between(
        tr.doc.resolve(Math.min(from, end)),
        tr.doc.resolve(Math.min(to, end))
      )
    )
    .setMeta("preventUpdate", true);
};

export const createChangeGate = (initial: string) => {
  let loaded = initial;
  let normal: string | null = null;
  let emitted = initial;

  return {
    change: (markdown: string, normalize: (value: string) => string) => {
      normal ??= normalize(loaded);

      const text = markdown === normal ? loaded : markdown;

      if (text === emitted) {
        return null;
      }

      emitted = text;

      return text;
    },
    emitted: () => emitted,
    load: (value: string) => {
      loaded = value;
      normal = null;
      emitted = value;
    },
  };
};

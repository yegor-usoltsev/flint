import { getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

import { markdownExtensions } from "~/lib/markdown";
import { withoutTrailingLines } from "~/lib/markdown-changes";
import {
  atomize,
  IssueMention,
  issueKeyPattern,
  PageMention,
} from "~/lib/markdown-mentions";

const extensions = [...markdownExtensions(), IssueMention, PageMention];
const schema = getSchema(extensions);
const manager = new MarkdownManager({ extensions });

const { paragraph } = schema.nodes;

export const parseDoc = (markdown: string, keys: string[]) => {
  const { doc } = atomize(
    EditorState.create({ doc: schema.nodeFromJSON(manager.parse(markdown)) })
      .tr,
    issueKeyPattern(keys)
  );

  return doc.lastChild?.type === paragraph || paragraph === undefined
    ? doc
    : doc.copy(doc.content.addToEnd(paragraph.create()));
};

export const checkTask = (
  doc: ProseMirrorNode,
  pos: number,
  checked: boolean
) => {
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- ProseMirror types Node.toJSON as any; it is the JSONContent that Tiptap's getJSON returns.
  const json: JSONContent = EditorState.create({ doc })
    .tr.setNodeAttribute(pos, "checked", checked)
    .doc.toJSON();

  return withoutTrailingLines(manager.serialize(json));
};

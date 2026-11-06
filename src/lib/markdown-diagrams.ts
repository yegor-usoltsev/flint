import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

import { markdownExtensions } from "~/lib/markdown";

const manager = new MarkdownManager({ extensions: markdownExtensions() });

const diagramCodes = (node: JSONContent): string[] =>
  node.type === "codeBlock" && node.attrs?.["language"] === "mermaid"
    ? [(node.content ?? []).map((child) => child.text ?? "").join("")]
    : (node.content ?? []).flatMap(diagramCodes);

export const diagramsIn = (markdown: string) =>
  diagramCodes(manager.parse(markdown));

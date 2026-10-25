import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

import { markdownExtensions } from "~/lib/markdown";

export interface Heading {
  id: string;
  level: number;
  text: string;
}

const manager = new MarkdownManager({ extensions: markdownExtensions() });

const textOf = (node: JSONContent): string =>
  node.text ?? (node.content ?? []).map(textOf).join("");

export const headingsOf = (markdown: string) => {
  const seen = new Map<string, number>();
  const headings: Heading[] = [];

  const visit = (node: JSONContent) => {
    if (node.type !== "heading") {
      for (const child of node.content ?? []) {
        visit(child);
      }

      return;
    }

    const level = Number(node.attrs?.["level"] ?? 1);
    const text = textOf(node).trim();

    if (level <= 3 && text !== "") {
      const count = (seen.get(text) ?? 0) + 1;

      seen.set(text, count);
      headings.push({ id: `${text}#${count}`, level, text });
    }
  };

  visit(manager.parse(markdown));

  return headings;
};

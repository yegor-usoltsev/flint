import { describe, expect, test } from "bun:test";

import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { markdownExtensions } from "~/lib/markdown";
import { withoutTrailingLines } from "~/lib/markdown-changes";
import { checkTask, parseDoc } from "~/lib/markdown-doc";
import { IssueMention, PageMention } from "~/lib/markdown-mentions";

const page = "/doc/0193a1b2-0000-7000-8000-000000000000";

const taskPositions = (doc: ProseMirrorNode) => {
  const found: number[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "taskItem") {
      found.push(pos);
    }
  });

  return found;
};

describe("parseDoc", () => {
  test("turns issue keys and page links into mentions", () => {
    const doc = parseDoc(`See ENG-1, OPS-2 and [Notes](${page}).`, ["ENG"]);
    const types: string[] = [];

    doc.descendants((node) => {
      types.push(node.type.name);
    });

    expect(types).toEqual([
      "paragraph",
      "text",
      "issueMention",
      "text",
      "pageMention",
      "text",
    ]);
  });

  test("ends with a paragraph, as the editor's trailing node does", () => {
    expect(parseDoc("```\ncode\n```", []).lastChild?.type.name).toBe(
      "paragraph"
    );
    expect(parseDoc("", []).toJSON()).toEqual({
      content: [{ type: "paragraph" }],
      type: "doc",
    });
  });
});

describe("checkTask", () => {
  test("writes the Markdown the editor writes for the same click", () => {
    const markdown = [
      "Steps for ENG-3:",
      "",
      "- [ ] First *step*",
      "- [x] Second",
      "  - [ ] Nested",
      "",
      "```ts",
      "const done = true;",
      "```",
    ].join("\n");

    const editor = new Editor({
      content: markdown,
      contentType: "markdown",
      extensions: [...markdownExtensions(), IssueMention, PageMention],
    });

    const doc = parseDoc(markdown, ["ENG"]);

    for (const [index, pos] of taskPositions(doc).entries()) {
      const target = taskPositions(editor.state.doc)[index] ?? -1;

      const checked =
        editor.state.doc.nodeAt(target)?.attrs["checked"] !== true;

      editor.view.dispatch(
        editor.state.tr.setNodeAttribute(target, "checked", checked)
      );

      expect(checkTask(doc, pos, checked)).toBe(
        withoutTrailingLines(editor.getMarkdown())
      );

      editor.view.dispatch(
        editor.state.tr.setNodeAttribute(target, "checked", !checked)
      );
    }

    editor.destroy();
  });
});

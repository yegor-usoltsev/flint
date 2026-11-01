import { expect, test } from "bun:test";

import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import { markdownExtensions } from "~/lib/markdown";
import { allowTrigger } from "~/lib/suggestion-trigger";

const manager = new MarkdownManager({ extensions: markdownExtensions() });

const roundTrip = (markdown: string) =>
  manager.serialize(manager.parse(markdown));

const load = (markdown: string) => {
  const editor = new Editor({
    content: markdown,
    contentType: "markdown",
    extensions: markdownExtensions(),
  });

  return EditorState.create({
    doc: editor.state.doc,
    plugins: editor.extensionManager.plugins,
  });
};

const positionOf = (state: EditorState, text: string) => {
  let found = -1;

  state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text) === true) {
      found = pos + (node.text?.indexOf(text) ?? 0);
    }
  });

  return found;
};

test("reads GitHub's one-line details form, nested too", () => {
  const markdown = [
    "<details><summary>Outer</summary>",
    "",
    "<details><summary>Inner</summary>",
    "",
    "Inner body",
    "",
    "</details>",
    "",
    "Outer rest",
    "",
    "</details>",
    "",
    "After",
  ].join("\n");

  const [outer, after] = manager.parse(markdown).content ?? [];

  expect(outer?.type).toBe("details");
  expect(outer?.content?.[1]?.content?.map((node) => node.type)).toEqual([
    "details",
    "paragraph",
  ]);
  expect(after?.type).toBe("paragraph");
});

test("decodes HTML entities in a summary and a backtick fence needs a plain info string", () => {
  const [entity] =
    manager.parse(
      "<details>\n<summary>A&nbsp;B &#39;C&#39; &#x26;</summary>\n\nBody\n\n</details>"
    ).content ?? [];

  expect(entity?.content?.[0]?.content?.[0]?.text).toBe("A B 'C' &");

  const [invalid] =
    manager.parse(
      "<details>\n<summary>&#xD800; &#128;</summary>\n\nBody\n\n</details>"
    ).content ?? [];

  expect(invalid?.content?.[0]?.content?.[0]?.text).toBe("&#xD800; &#128;");

  const multiline =
    "<details>\n<summary>A&#10;B&#13;&#10;C</summary>\n\nBody\n\n</details>";

  expect(roundTrip(multiline)).toBe(
    "<details>\n<summary>A B C</summary>\n\nBody\n\n</details>"
  );

  const fenced =
    "<details>\n<summary>S</summary>\n\n```x``` is code\n\n</details>\n\nAfter";

  expect(manager.parse(fenced).content?.[0]?.type).toBe("details");
  expect(roundTrip(roundTrip(fenced))).toBe(roundTrip(fenced));
});

test("a caret moving into a collapsed body lands outside it, even at the end of the document", () => {
  const state = load(
    "Before\n\n<details>\n<summary>S</summary>\n\nHidden\n\n</details>"
  );

  const into = positionOf(state, "Hidden");

  const moved = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, into))
  );

  const { $from } = moved.selection;

  expect($from.parent.type.name).toBe("detailsSummary");
});

test("slash and mention menus stay closed inside a summary", () => {
  const state = load("<details>\n<summary>S /</summary>\n\nBody\n\n</details>");
  const slash = positionOf(state, "/");

  expect(allowTrigger({ range: { from: slash, to: slash + 1 }, state })).toBe(
    false
  );
});

test("a selected range inside a collapsed body moves out too", () => {
  const state = load(
    "Before\n\n<details>\n<summary>S</summary>\n\nHidden body\n\n</details>\n\nAfter"
  );

  const from = positionOf(state, "Hidden");

  const moved = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, from + 6))
  );

  expect(moved.selection.empty).toBe(true);
  expect(moved.selection.$from.parent.type.name).toBe("detailsSummary");
});

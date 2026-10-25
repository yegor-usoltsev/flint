import { expect, test } from "bun:test";

import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorState } from "@tiptap/pm/state";

import { outsideLink } from "~/components/editor-uploads";
import { markdownExtensions } from "~/lib/markdown";

const extensions = markdownExtensions();
const schema = getSchema(extensions);
const manager = new MarkdownManager({ extensions });

const state = EditorState.create({
  doc: schema.nodeFromJSON(manager.parse("Read [notes](/files/a) now")),
});

// Positions count the paragraph's opening token: "Read " ends at 6, "notes" spans 6-11.
test("an upload dropped inside a link's text lands after the link", () => {
  expect(outsideLink(state, 8)).toBe(11);
});

test.each([2, 6, 11, 13])(
  "an upload outside a link keeps its position %p",
  (position) => {
    expect(outsideLink(state, position)).toBe(position);
  }
);

import { expect, test } from "bun:test";

import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorState } from "@tiptap/pm/state";
import { findSuggestionMatch } from "@tiptap/suggestion";

import { markdownExtensions } from "~/lib/markdown";
import { allowedPrefixes, allowTrigger } from "~/lib/suggestion-trigger";

const extensions = markdownExtensions();
const schema = getSchema(extensions);
const manager = new MarkdownManager({ extensions });

const load = (markdown: string) =>
  EditorState.create({ doc: schema.nodeFromJSON(manager.parse(markdown)) });

// The caret sits at the end of the first block, as after typing its text.
const trigger = (markdown: string) => {
  const state = load(markdown);
  const end = (state.doc.firstChild?.nodeSize ?? 2) - 1;

  const match = findSuggestionMatch({
    $position: state.doc.resolve(end),
    allowSpaces: false,
    allowToIncludeChar: false,
    allowedPrefixes,
    char: "/",
    startOfLine: false,
  });

  return match !== null && allowTrigger({ range: match.range, state });
};

test.each([
  "/",
  "/ta",
  "Insert /co",
  "Insert\t/co",
  "Insert\u2003/co",
  "Insert\u00A0/co",
  "First line\\\n/co",
])("the slash menu opens for %p", (text) => {
  expect(trigger(text)).toBe(true);
});

test.each([
  "https://host/acme/wiki/engineer",
  "and/or",
  "Insert\u200B/co",
  "[see /files](https://example.com/x)",
  "`run /bin`",
])("the slash menu stays closed in %p", (text) => {
  expect(trigger(text)).toBe(false);
});

import { describe, expect, test } from "bun:test";

import { Editor, getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import { markdownExtensions } from "~/lib/markdown";
import { replaceMarkdown } from "~/lib/markdown-changes";
import {
  IssueMention,
  issueKeyPattern,
  atomize,
  Mentions,
  mentionsKey,
  PageMention,
} from "~/lib/markdown-mentions";

const extensions = [...markdownExtensions(), IssueMention, PageMention];
const schema = getSchema(extensions);
const manager = new MarkdownManager({ extensions });
const pattern = issueKeyPattern(["ENG", "OPS"]);
const page = "/doc/0193a1b2-0000-7000-8000-000000000000";

const load = (markdown: string) =>
  EditorState.create({ doc: schema.nodeFromJSON(manager.parse(markdown)) });

const convert = (markdown: string, caret: number | null = null) =>
  atomize(load(markdown).tr, pattern, caret).doc;

const mentions = (doc: ReturnType<typeof convert>) => {
  const found: JSONContent[] = [];

  doc.descendants((node) => {
    if (node.type.name.endsWith("Mention")) {
      found.push({ attrs: node.attrs, type: node.type.name });
    }
  });

  return found;
};

const serialize = (doc: ReturnType<typeof convert>) => {
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- ProseMirror types Node.toJSON as any; it is JSONContent.
  const json: JSONContent = doc.toJSON();

  return manager.serialize(json);
};

describe("mentions", () => {
  test("turns known keys and page links into atoms and keeps the Markdown", () => {
    const markdown = `See ENG-12, **OPS-3** and [Deploy guide](${page}).\n\nNot UTF-8, ABC-1, \`ENG-4\`, [ENG-5](https://example.com) or [Bold **page**](${page}).\n\n\`\`\`\nENG-6\n\`\`\``;
    const doc = convert(markdown);

    expect(mentions(doc)).toEqual([
      { attrs: { key: "ENG-12" }, type: "issueMention" },
      {
        attrs: { href: page, label: "Deploy guide" },
        type: "pageMention",
      },
    ]);
    expect(serialize(doc)).toBe(markdown);
  });

  test("leaves a titled page link as a link", () => {
    const markdown = `Read [Deploy](${page} "Runbook") first.`;
    const doc = convert(markdown);

    expect(mentions(doc)).toEqual([]);
    expect(serialize(doc)).toBe(markdown);
  });

  test("keeps escaped link text", () => {
    const markdown = `Read [the \\[draft\\] \\*notes\\*](${page}).`;

    expect(serialize(convert(markdown))).toBe(markdown);
  });

  test("converts a key at the start of a loaded document", () => {
    expect(mentions(convert("ENG-1 opens the list"))).toEqual([
      { attrs: { key: "ENG-1" }, type: "issueMention" },
    ]);
  });

  test("waits while the typing caret touches a key", () => {
    expect(mentions(convert("Fix ENG-1", 10))).toEqual([]);
    expect(mentions(convert("Fix ENG-1", 6))).toEqual([]);
    expect(mentions(convert("Fix ENG-1 now", 12))).toEqual([
      { attrs: { key: "ENG-1" }, type: "issueMention" },
    ]);
  });

  test("leaves documents without keys untouched", () => {
    expect(atomize(load("Plain text").tr, pattern).docChanged).toBe(false);
    expect(atomize(load("ENG-1").tr, null).docChanged).toBe(false);
  });
});

// A headless editor keeps its plugins out of its own state, so the state is built from them.
const open = (markdown: string) => {
  const editor = new Editor({
    content: markdown,
    contentType: "markdown",
    extensions: [...extensions, Mentions.configure({ pattern: () => pattern })],
  });

  const initial = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.extensionManager.plugins,
  });

  return initial.applyTransaction(initial.tr.setMeta(mentionsKey, true)).state;
};

const beforeCaret = (state: EditorState) =>
  state.doc.textBetween(0, state.selection.from, "\n", "@");

describe("mentions in an editor", () => {
  test("converts a key at the start of the document on open", () => {
    expect(mentions(open("ENG-1 opens the list").doc)).toEqual([
      { attrs: { key: "ENG-1" }, type: "issueMention" },
    ]);
  });

  test.each([
    ["See ENG-1 tail", "See ENG-1 tail!"],
    [
      `See [Deploy](${page}) and ENG-1 tail`,
      `See [Deploy](${page}) and ENG-1 tail!`,
    ],
  ])("keeps the caret when a remote save replaces %p", (before, after) => {
    const opened = open(before);

    const { state } = opened.applyTransaction(
      opened.tr.setSelection(
        TextSelection.create(opened.doc, opened.doc.content.size - 1)
      )
    );

    const caret = beforeCaret(state);

    const { state: next } = state.applyTransaction(
      replaceMarkdown(state, manager, after, pattern)
    );

    expect(caret).toEndWith("@ tail");
    expect(beforeCaret(next)).toBe(caret);
    expect(serialize(next.doc)).toBe(after);
  });
});

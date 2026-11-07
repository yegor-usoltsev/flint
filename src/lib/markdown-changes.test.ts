import { describe, expect, test } from "bun:test";

import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";

import { markdownExtensions } from "~/lib/markdown";
import {
  createChangeGate,
  createThrottle,
  normalizeMarkdown,
  serializeState,
} from "~/lib/markdown-changes";

const nonCanonical = `* first
* second


__bold__ and *emphasis*



Some text
***

\`\`\`ts
const answer = 42;
\`\`\``;

const load = (markdown: string) => {
  const editor = new Editor({
    content: markdown,
    contentType: "markdown",
    extensions: markdownExtensions(),
  });

  const manager = editor.markdown;

  if (manager === undefined) {
    throw new Error("The Markdown extension is missing");
  }

  let state = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.extensionManager.plugins,
  });

  const gate = createChangeGate(markdown);

  const apply = (change: (tr: Transaction) => Transaction) => {
    ({ state } = state.applyTransaction(change(state.tr)));

    return gate.change(serializeState(state, manager), (value) =>
      normalizeMarkdown(state, manager, value)
    );
  };

  return { apply, gate };
};

describe("change gate", () => {
  test("loading non-canonical Markdown with a trailing code block emits nothing", () => {
    const { apply } = load(nonCanonical);

    expect(apply((tr) => tr.setMeta("load", true))).toBeNull();
  });

  test("loading non-canonical media HTML emits nothing", () => {
    const { apply } = load(`Intro
<img width=320 src='/files/a'>
<video src="/files/v" autoplay width="480"></video>
<audio src="/files/s"></audio>`);

    expect(apply((tr) => tr.setMeta("load", true))).toBeNull();
  });

  test("loading code blocks, diagrams and a loose table emits nothing", () => {
    const { apply } = load(`\`\`\`TS
const answer = 42;
\`\`\`

~~~
plain
~~~

\`\`\`mermaid
graph LR
  A --> B
\`\`\`

|a|b|
|-|-|
|1|2|`);

    expect(apply((tr) => tr.setMeta("load", true))).toBeNull();
  });

  test("a real edit emits the new text, and undoing it emits the loaded text", () => {
    const { apply } = load(nonCanonical);

    apply((tr) => tr.setMeta("load", true));

    const edited = apply((tr) => tr.insertText("New ", 3));

    expect(edited).toContain("New first");

    expect(apply((tr) => tr.delete(3, 3 + "New ".length))).toBe(nonCanonical);
  });

  test("an edit to a body that ends in a list emits no trailing blank line", () => {
    const { apply } = load("- [ ] Tag the release");

    expect(apply((tr) => tr.insertText("New ", 3))).toBe(
      "- [ ] New Tag the release"
    );
  });

  test("after a new value loads, a document that differs from it emits", () => {
    const { apply, gate } = load("old");

    gate.load(nonCanonical);

    expect(gate.emitted()).toBe(nonCanonical);
    expect(apply((tr) => tr.setMeta("load", true))).not.toBeNull();
  });
});

describe("createThrottle", () => {
  test("runs the first change at once and the last of a burst once after the delay", async () => {
    const throttle = createThrottle(20);
    const runs: string[] = [];

    for (const text of ["a", "ab", "abc"]) {
      throttle.run(() => {
        runs.push(text);
      }, true);
    }

    expect(runs).toEqual(["a"]);

    await Bun.sleep(30);

    expect(runs).toEqual(["a", "abc"]);

    await Bun.sleep(30);
    throttle.run(() => {
      runs.push("abcd");
    }, true);

    expect(runs).toEqual(["a", "abc", "abcd"]);
  });

  test("a flush runs the pending change at once and only once", async () => {
    const throttle = createThrottle(20);
    const runs: string[] = [];

    throttle.run(() => {
      runs.push("a");
    }, true);
    throttle.run(() => {
      runs.push("ab");
    }, true);
    throttle.flush();
    throttle.flush();

    expect(runs).toEqual(["a", "ab"]);

    await Bun.sleep(30);

    expect(runs).toEqual(["a", "ab"]);
  });

  test("without throttling every change runs at once", () => {
    const throttle = createThrottle(20);
    const runs: string[] = [];

    for (const text of ["a", "ab"]) {
      throttle.run(() => {
        runs.push(text);
      }, false);
    }

    expect(runs).toEqual(["a", "ab"]);
  });
});

import { Extension, mergeAttributes, Node } from "@tiptap/core";
import type { Editor, JSONContent, NodeViewRenderer } from "@tiptap/core";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export const mentionsKey = new PluginKey("mentions");

export const docPath =
  /^\/doc\/(?<id>[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/iu;

export const issueKeyPattern = (keys: string[]) =>
  keys.length === 0
    ? null
    : new RegExp(String.raw`\b(?:${keys.join("|")})-\d+\b`, "gu");

export const IssueMention = Node.create<{ view?: NodeViewRenderer }>({
  addAttributes: () => ({
    key: {
      default: "",
      parseHTML: (element) => element.dataset["issueKey"] ?? "",
      renderHTML: ({ key }) => ({ "data-issue-key": String(key ?? "") }),
    },
  }),
  addNodeView() {
    return this.options.view ?? null;
  },
  addOptions: () => ({}),
  atom: true,
  group: "inline",
  inline: true,
  name: "issueMention",
  parseHTML: () => [{ priority: 100, tag: "a[data-issue-key]" }],
  renderHTML: ({ HTMLAttributes, node }) => [
    "a",
    HTMLAttributes,
    String(node.attrs["key"] ?? ""),
  ],
  renderMarkdown: (node: JSONContent) => String(node.attrs?.["key"] ?? ""),
  renderText: ({ node }) => String(node.attrs["key"] ?? ""),
});

export const PageMention = Node.create<{ view?: NodeViewRenderer }>({
  addAttributes: () => ({
    href: {
      default: "",
      parseHTML: (element) => element.getAttribute("href") ?? "",
    },
    label: {
      default: "",
      parseHTML: (element) => element.textContent,
      rendered: false,
    },
  }),
  addNodeView() {
    return this.options.view ?? null;
  },
  addOptions: () => ({}),
  atom: true,
  group: "inline",
  inline: true,
  name: "pageMention",
  parseHTML: () => [{ priority: 100, tag: "a[data-page-mention]" }],
  renderHTML: ({ HTMLAttributes, node }) => [
    "a",
    mergeAttributes(HTMLAttributes, { "data-page-mention": "" }),
    String(node.attrs["label"] ?? ""),
  ],
  // The stored link keeps the text it was written with; the chip shows the page's current title.
  renderMarkdown: (node: JSONContent, helpers) =>
    helpers.renderChildren([
      {
        marks: [
          { attrs: { href: String(node.attrs?.["href"] ?? "") }, type: "link" },
        ],
        text: String(node.attrs?.["label"] ?? ""),
        type: "text",
      },
    ]),
  renderText: ({ node }) => String(node.attrs["label"] ?? ""),
});

const pageLink = (marks: readonly Mark[]) => {
  const [mark, ...rest] = marks;
  const href = String(mark?.attrs["href"] ?? "");

  // A chip has nowhere to keep a link title, so a titled link stays a link.
  const plain =
    mark?.type.name === "link" &&
    rest.length === 0 &&
    (mark.attrs["title"] ?? "") === "";

  return plain && docPath.test(href) ? href : null;
};

const linked = (node: ProseMirrorNode | null | undefined, href: string) =>
  node?.marks.some(
    (mark) => mark.type.name === "link" && mark.attrs["href"] === href
  ) === true;

interface Replacement {
  from: number;
  node: ProseMirrorNode;
  to: number;
}

const replacements = (
  doc: ProseMirrorNode,
  pattern: RegExp | null,
  caret: number | null
) => {
  const issue = doc.type.schema.nodes["issueMention"];
  const page = doc.type.schema.nodes["pageMention"];
  const found: Replacement[] = [];

  if (issue === undefined || page === undefined) {
    return found;
  }

  doc.descendants((node, position, parent, index) => {
    if (node.type.spec.code === true) {
      return false;
    }

    if (!node.isText) {
      return true;
    }

    const href = pageLink(node.marks);

    const whole =
      href !== null &&
      !linked(index > 0 ? parent?.child(index - 1) : null, href) &&
      !linked(parent?.maybeChild(index + 1), href);

    if (href !== null && whole) {
      found.push({
        from: position,
        node: page.create({ href, label: node.text }),
        to: position + node.nodeSize,
      });
    } else if (pattern !== null && node.marks.length === 0) {
      for (const match of (node.text ?? "").matchAll(pattern)) {
        const from = position + match.index;
        const to = from + match[0].length;

        if (caret === null || caret < from || caret > to) {
          found.push({ from, node: issue.create({ key: match[0] }), to });
        }
      }
    }

    return false;
  });

  return found;
};

// A key that touches `caret` may still be typed (ENG-1 before ENG-12), so it stays text until the next character or a caret move.
export const atomize = (
  tr: Transaction,
  pattern: RegExp | null,
  caret: number | null = null
) => {
  for (const { from, node, to } of replacements(
    tr.doc,
    pattern,
    caret
  ).toReversed()) {
    tr.replaceWith(from, to, node);
  }

  return tr;
};

// Only a key the user is typing waits; loaded, replaced or read-only content converts at once, including a key at the initial caret.
const typingCaret = (
  editor: Editor,
  transactions: readonly Transaction[],
  state: EditorState
) => {
  const userEdit =
    transactions.some((transaction) => transaction.docChanged) &&
    !transactions.some(
      (transaction) => transaction.getMeta("preventUpdate") === true
    );

  const typed =
    userEdit && editor.isEditable && editor.isFocused && state.selection.empty;

  return typed ? state.selection.head : null;
};

// Tiptap drops marks on inline atoms when it writes Markdown, so only unformatted keys and links become mentions. Mentions stay plain `KEY-N` and `[title](/doc/<id>)` in Markdown; the editor turns them into atoms, so the caret steps over a chip and Backspace removes it whole.
export const Mentions = Extension.create<{ pattern: () => RegExp | null }>({
  addOptions: () => ({ pattern: () => null }),
  addProseMirrorPlugins() {
    const { editor } = this;
    const { pattern } = this.options;

    return [
      new Plugin({
        appendTransaction: (transactions, _old, state) => {
          const edited = transactions.some(
            (transaction) => transaction.docChanged
          );

          const relevant =
            edited ||
            transactions.some(
              (transaction) =>
                transaction.selectionSet ||
                transaction.getMeta(mentionsKey) === true
            );

          if (!relevant) {
            return null;
          }

          const tr = atomize(
            state.tr,
            pattern(),
            typingCaret(editor, transactions, state)
          );

          if (!tr.docChanged) {
            return null;
          }

          return edited ? tr : tr.setMeta("addToHistory", false);
        },
        key: mentionsKey,
      }),
    ];
  },
  name: "mentions",
});

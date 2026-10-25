import type {
  JSONContent,
  MarkdownToken,
  NodeViewRenderer,
} from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableKit, TableView } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { lowlight } from "~/lib/code-languages";
import { mediaExtensions } from "~/lib/markdown-media";

const safeUrl = /^(?:https?:|mailto:|\/(?![/\\])|#)/iu;

export const isSafeUrl = (url: string) =>
  safeUrl.test(url.trim()) && !/\p{Cc}/u.test(url.trim());

const escapeText = (text: string) =>
  text
    .replaceAll(
      /[\\`*[\]~]|_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_/gu,
      String.raw`\$&`
    )
    .replaceAll(/<(?=[\p{L}/!?])/gu, String.raw`\<`)
    .replaceAll(/&(?=#?\w+;)/gu, String.raw`\&`)
    .replace(/^>/u, String.raw`\>`);

const encodeText = v.parse(
  v.function(),
  Object.getOwnPropertyDescriptor(
    MarkdownManager.prototype,
    "encodeTextForMarkdown"
  )?.value
);

const blockMarkers = [
  /^#{1,6}(?:\s|$)/u,
  /^[-+](?:\s|$)/u,
  /^(?:-+|=+)\s*$/u,
  /^>/u,
];

const escapeLineStart = (line: string) =>
  blockMarkers.some((marker) => marker.test(line))
    ? `\\${line}`
    : line.replace(/^(?<number>\d{1,9})(?=[.)](?:\s|$))/u, "$<number>\\");

const codeTypes = new Set(["code", "codeBlock"]);

const startsLine = (node: JSONContent, parent?: JSONContent) => {
  const siblings = parent?.content ?? [];
  const index = siblings.indexOf(node);

  return index <= 0 || siblings[index - 1]?.type === "hardBreak";
};

// Tiptap writes `<` and `&` as HTML entities, which agents then read through the CLI; backslash escapes keep the source readable and stable. It also leaves block markers such as `# ` or `1. ` at a line start unescaped, which turns a literal paragraph into a heading or list on the next parse.
Reflect.set(
  MarkdownManager.prototype,
  "encodeTextForMarkdown",
  function encodeTextForMarkdown(
    this: MarkdownManager,
    text: string,
    node: JSONContent,
    parent?: JSONContent
  ) {
    const inCode =
      codeTypes.has(parent?.type ?? "") ||
      (node.marks ?? []).some((mark) => codeTypes.has(mark.type));

    if (inCode) {
      return text;
    }

    const escaped =
      encodeText.call(this, text, node, parent) === text
        ? text
        : escapeText(text);

    return escaped
      .split("\n")
      .map((line, index) =>
        index > 0 || startsLine(node, parent) ? escapeLineStart(line) : line
      )
      .join("\n");
  }
);

// In the browser Tiptap parses raw HTML through the schema, which drops `<script>` text and turns `<b>` into bold on the next save; keeping it literal matches the server and leaves only media lines (`markdown-media.ts`) as HTML.
Reflect.set(
  MarkdownManager.prototype,
  "parseHTMLToken",
  (token: {
    block?: boolean;
    raw?: string;
    text?: string;
  }): JSONContent | null => {
    const text = (token.text ?? token.raw ?? "").trimEnd();

    if (text === "") {
      return null;
    }

    return token.block === true
      ? { content: [{ text, type: "text" }], type: "paragraph" }
      : { text, type: "text" };
  }
);

const fence = (marker: "`" | "~", code: string) =>
  marker.repeat(
    Math.max(
      3,
      ...[...code.matchAll(marker === "`" ? /`+/gu : /~+/gu)].map(
        ([run]) => run.length + 1
      )
    )
  );

// Tiptap always fences with three backticks, so a block holding its own fence (a Markdown example) breaks apart on the next parse.
const codeBlock = CodeBlockLowlight.extend({
  renderMarkdown: (node, helpers) => {
    const language = String(node.attrs?.["language"] ?? "");
    const code = helpers.renderChildren(node.content ?? []);
    const marker = fence(language.includes("`") ? "~" : "`", code);

    return `${marker}${language}\n${code}\n${marker}`;
  },
}).configure({ lowlight });

class ScrollingTableView extends TableView {
  constructor(...args: ConstructorParameters<typeof TableView>) {
    super(...args);
    this.dom.tabIndex = 0;
  }
}

// GFM table cells hold no newlines, so Tiptap writes a line break in a cell as `<br>`; reading it back as a break keeps the cell stable, while raw HTML elsewhere stays text.
const lineBreak = /^<br\s*\/?>$/iu;

const withBreaks = (tokens: MarkdownToken[] = []): MarkdownToken[] =>
  tokens.map((token) => {
    if (token.type === "html" && lineBreak.test(token.raw?.trim() ?? "")) {
      return { raw: token.raw, type: "br" };
    }

    return token.tokens === undefined
      ? token
      : { ...token, tokens: withBreaks(token.tokens) };
  });

const CellsSchema = v.optional(
  v.array(v.custom<MarkdownToken>((value) => v.is(v.looseObject({}), value)))
);

const cellBreaks = (cell: MarkdownToken) => ({
  ...cell,
  tokens: withBreaks(cell.tokens),
});

// Tiptap wraps a table in newlines, which become an extra blank line on each side.
const table = Table.extend({
  parseMarkdown(token, helpers) {
    const header = v.parse(CellsSchema, token["header"]);
    const rows = v.parse(v.optional(v.array(CellsSchema)), token["rows"]);

    return (
      this.parent?.(
        {
          ...token,
          header: header?.map(cellBreaks),
          rows: rows?.map((row) => row?.map(cellBreaks)),
        },
        helpers
      ) ?? []
    );
  },
  renderMarkdown(node, helpers, context) {
    return (this.parent?.(node, helpers, context) ?? "").trim();
  },
}).configure({ resizable: false, View: ScrollingTableView });

export const markdownExtensions = ({
  codeBlockView,
  onReadOnlyChecked,
}: {
  codeBlockView?: NodeViewRenderer;
  onReadOnlyChecked?: () => boolean;
} = {}) => [
  StarterKit.configure({
    codeBlock: false,
    link: {
      autolink: true,
      isAllowedUri: (url) => isSafeUrl(url),
      openOnClick: false,
      shouldAutoLink: (url) => isSafeUrl(url) || !url.includes(":"),
    },
    paragraph: false,
    underline: false,
  }),
  codeBlockView === undefined
    ? codeBlock
    : codeBlock.extend({ addNodeView: () => codeBlockView }),
  TaskList,
  TaskItem.configure({ nested: true, onReadOnlyChecked }),
  table,
  TableKit.configure({ table: false }),
  ...mediaExtensions,
  Markdown.configure({ markedOptions: { gfm: true } }),
];

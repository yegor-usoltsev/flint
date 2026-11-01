import type {
  JSONContent,
  MarkdownLexerConfiguration,
  MarkdownToken,
  NodeViewRenderer,
} from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import {
  ListItem,
  OrderedList,
  TaskItem,
  TaskList,
} from "@tiptap/extension-list";
import {
  Table,
  TableCell,
  TableHeader,
  TableKit,
  TableView,
} from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { lowlight } from "~/lib/code-languages";
import { detailsExtensions } from "~/lib/markdown-details";
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

const taskItem = TaskItem.extend({
  addNodeView() {
    const view = this.parent?.();

    if (view === null || view === undefined) {
      return null;
    }

    return (props) => {
      const rendered = view(props);

      const checkbox = rendered.dom?.querySelector("input");

      checkbox?.addEventListener("change", () => {
        const pos = props.getPos();

        const node =
          pos === undefined ? null : props.editor.state.doc.nodeAt(pos);

        if (
          props.editor.isEditable ||
          pos === undefined ||
          node?.attrs["checked"] === checkbox.checked
        ) {
          return;
        }

        props.editor.view.dispatch(
          props.editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node?.attrs,
            checked: checkbox.checked,
          })
        );
      });

      return rendered;
    };
  },
});

const isEmptyParagraph = (node?: JSONContent) =>
  node?.type === "paragraph" && (node.content ?? []).length === 0;

const withLeadingParagraph = (content: JSONContent[] = []) => {
  const start = content.findIndex((node) => !isEmptyParagraph(node));
  const rest = start === -1 ? [] : content.slice(start);

  if (rest.length === 0) {
    return [{ type: "paragraph" }];
  }

  return rest[0]?.type === "paragraph"
    ? rest
    : [{ type: "paragraph" }, ...rest];
};

const listItem = ListItem.extend({
  parseMarkdown(token, helpers) {
    const item = this.parent?.(token, helpers);

    return item === undefined || Array.isArray(item)
      ? (item ?? [])
      : { ...item, content: withLeadingParagraph(item.content) };
  },
  renderMarkdown(node, helpers, context) {
    const content = withLeadingParagraph(node.content);

    const markdown =
      this.parent?.({ ...node, content }, helpers, context) ?? "";

    return isEmptyParagraph(content[0]) && content.length > 1
      ? markdown.replace(/^(?<marker>[^\n]*)\n[ \t]*/u, "$<marker>")
      : markdown;
  },
});

const unindentItem = (source: string, width: number) =>
  source
    .split("\n")
    .map((line) =>
      line.slice(Math.min(width, line.length - line.trimStart().length))
    )
    .join("\n");

const blockFirstItem = (
  item: MarkdownToken,
  lexer: MarkdownLexerConfiguration
): MarkdownToken => {
  const original = () => ({
    ...item,
    tokens: item.tokens?.map((token) =>
      token.type === "list" && token["ordered"] === true
        ? {
            ...token,
            items: token.items?.map((child) => blockFirstItem(child, lexer)),
          }
        : token
    ),
  });

  const raw = item.raw ?? "";

  const match = /^(?<prefix>[ \t]*[^\s.)]+[.)][ \t]+)(?<first>[^\n]*)/u.exec(
    raw
  );

  if (match === null) {
    return original();
  }

  const width = match.groups?.["prefix"]?.length ?? 0;
  const first = match.groups?.["first"] ?? "";
  const source = first + unindentItem(raw.slice(match[0].length), width);

  const nested =
    item.tokens?.filter(
      (token) => token.type === "list" && token["ordered"] === true
    ) ?? [];

  const blocks = lexer.blockTokens(
    [
      source,
      ...nested.map((token) => unindentItem(token.raw ?? "", width)),
    ].join("\n")
  );

  const type = blocks[0]?.type;

  if (
    type === undefined ||
    ["paragraph", "text", "space", "html", "list"].includes(type) ||
    (type === "heading" && !/^#{1,6}(?:[ \t]|$)/u.test(first))
  ) {
    return original();
  }

  return { ...item, tokens: blocks };
};

const orderedList = OrderedList.extend({
  markdownTokenizer: {
    ...OrderedList.config.markdownTokenizer,
    name: "orderedList",
    tokenize: (source, tokens, lexer) => {
      const token = OrderedList.config.markdownTokenizer?.tokenize(
        source,
        tokens,
        lexer
      );

      return token === undefined
        ? undefined
        : {
            ...token,
            items: token.items?.map((item) => blockFirstItem(item, lexer)),
          };
    },
  },
  parseMarkdown(token, helpers) {
    const list = this.parent?.(token, helpers);

    return list === undefined || Array.isArray(list)
      ? (list ?? [])
      : {
          ...list,
          content: list.content?.map((item) =>
            item.type === "listItem"
              ? { ...item, content: withLeadingParagraph(item.content) }
              : item
          ),
        };
  },
});

const tableCell = TableCell.extend({ content: "paragraph+" });

const tableHeader = TableHeader.extend({ content: "paragraph+" });

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
    listItem: false,
    orderedList: false,
    paragraph: false,
    underline: false,
  }),
  listItem,
  orderedList,
  codeBlockView === undefined
    ? codeBlock
    : codeBlock.extend({ addNodeView: () => codeBlockView }),
  TaskList,
  taskItem.configure({ nested: true, onReadOnlyChecked }),
  table,
  TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
  tableCell,
  tableHeader,
  ...mediaExtensions,
  ...detailsExtensions,
  Markdown.configure({ markedOptions: { gfm: true } }),
];

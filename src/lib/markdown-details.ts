import type {
  Editor,
  JSONContent,
  MarkdownParseHelpers,
  MarkdownToken,
} from "@tiptap/core";
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details";
import type { ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";

const tag = String.raw`<details(?:\s+open(?:="[^"\n]*")?)?>`;

const open = new RegExp(
  String.raw`^ {0,3}${tag}[ \t]*(?:\n[ \t]*)?<summary>(?<summary>[^\n]*?)<\/summary>[ \t]*(?:\n|$)`,
  "iu"
);

const boundary = new RegExp(
  String.raw`^ {0,3}(?:(?<close><\/details>)|${tag}(?:[ \t]*<summary>.*<\/summary>)?)[ \t]*$`,
  "iu"
);

const fenceOpen = /^ {0,3}(?<marker>`{3,}(?=[^`]*$)|~{3,})/u;

const fenceClose = /^ {0,3}(?<marker>`{3,}|~{3,})[ \t]*$/u;

const detailsStart = new RegExp(
  String.raw`^ {0,3}${tag}[ \t]*(?:\n[ \t]*)?<summary>`,
  "imu"
);

const fenceClosed = (fence: string, line: string) => {
  const marker = fenceClose.exec(line)?.groups?.["marker"] ?? "";

  return marker.startsWith(fence.charAt(0)) && marker.length >= fence.length;
};

const depthChange = (line: string) => {
  const match = boundary.exec(line);

  if (match === null) {
    return 0;
  }

  return match.groups?.["close"] === undefined ? 1 : -1;
};

const closing = (body: string) => {
  let depth = 1;
  let fence: string | null = null;
  let index = 0;

  for (const line of body.split("\n")) {
    if (fence === null) {
      fence = fenceOpen.exec(line)?.groups?.["marker"] ?? null;
      depth += fence === null ? depthChange(line) : 0;

      if (depth === 0) {
        return { index, length: line.length };
      }
    } else if (fenceClosed(fence, line)) {
      fence = null;
    }

    index += line.length + 1;
  }

  return null;
};

const graphemes = new Intl.Segmenter();

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const entities = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00A0"],
  ["quot", '"'],
]);

const undecodable = (code: number) =>
  [
    [0x80, 0x9f],
    [0xd8_00, 0xdf_ff],
  ].some(([from = 0, to = 0]) => code >= from && code <= to);

const unescapeHtml = (text: string) =>
  text.replaceAll(
    /&(?:#(?<decimal>\d{1,7})|#x(?<hex>[\da-f]{1,6})|(?<name>[a-z]+));/giu,
    (entity, decimal?: string, hex?: string, name?: string) => {
      const code =
        decimal === undefined
          ? Number.parseInt(hex ?? "", 16)
          : Number(decimal);

      if (name !== undefined) {
        return entities.get(name.toLowerCase()) ?? entity;
      }

      const valid = code > 0 && code <= 0x10_ff_ff && !undecodable(code);

      return valid ? String.fromCodePoint(code) : entity;
    }
  );

const hiddenDepth = ($pos: ResolvedPos) => {
  for (let depth = 1; depth < $pos.depth; depth += 1) {
    if (
      $pos.node(depth).type.name === "details" &&
      $pos.node(depth).attrs["open"] !== true &&
      $pos.node(depth + 1).type.name === "detailsContent"
    ) {
      return depth;
    }
  }

  return null;
};

const MarkdownDetails = Details.extend({
  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};

    const enter = (props: { editor: Editor }) => {
      const { $head, empty } = props.editor.state.selection;
      const inSummary = empty && $head.parent.type.name === "detailsSummary";
      const details = inSummary ? $head.node(-1) : null;
      const first = details?.lastChild?.firstChild;

      if (
        details?.attrs["open"] === true &&
        first?.type.name === "paragraph" &&
        first.content.size === 0
      ) {
        return props.editor.commands.setTextSelection($head.after() + 2);
      }

      return parent["Enter"]?.(props) ?? false;
    };

    const backspace = (props: { editor: Editor }) => {
      const { $anchor, empty } = props.editor.state.selection;

      if (
        empty &&
        $anchor.parent.type.name === "detailsSummary" &&
        $anchor.parentOffset > 0
      ) {
        const before = $anchor.parent.textBetween(0, $anchor.parentOffset);
        const last = [...graphemes.segment(before)].at(-1);

        return props.editor.commands.deleteRange({
          from: $anchor.pos - (last?.segment.length ?? 1),
          to: $anchor.pos,
        });
      }

      return parent["Backspace"]?.(props) ?? false;
    };

    return { ...parent, Backspace: backspace, Enter: enter };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, previous, state) => {
          if (!transactions.some(({ selectionSet }) => selectionSet)) {
            return null;
          }

          const { $from, $to, empty } = state.selection;

          const $hidden = [$from, $to].find(
            ($pos) => hiddenDepth($pos) !== null
          );

          const depth = $hidden === undefined ? null : hiddenDepth($hidden);

          if ($hidden === undefined || depth === null) {
            return null;
          }

          const summaryEnd = TextSelection.create(
            state.doc,
            $hidden.start(depth) +
              ($hidden.node(depth).firstChild?.nodeSize ?? 2) -
              1
          );

          const after =
            empty && previous.selection.from < state.selection.from
              ? Selection.findFrom(state.doc.resolve($hidden.after(depth)), 1)
              : null;

          return state.tr.setSelection(after ?? summaryEnd);
        },
        key: new PluginKey("detailsSelection"),
      }),
    ];
  },
  addNodeView() {
    const view = this.parent?.();

    if (view === null || view === undefined) {
      return null;
    }

    return (props) => {
      const rendered = view(props);

      rendered.dom?.addEventListener(
        "click",
        (event) => {
          const pos = props.getPos();
          const toggle = rendered.dom?.firstChild;

          if (
            pos === undefined ||
            !(event.target instanceof Node) ||
            toggle?.contains(event.target) !== true
          ) {
            return;
          }

          event.stopPropagation();

          const current = props.editor.state.doc.nodeAt(pos);

          const { tr } = props.editor.state;

          props.editor.view.dispatch(
            tr
              .setNodeMarkup(pos, undefined, {
                open: current?.attrs["open"] !== true,
              })
              .setSelection(tr.selection)
              .setMeta("addToHistory", false)
              .setMeta("preventUpdate", true)
          );
        },
        { capture: true }
      );

      return rendered;
    };
  },
  markdownTokenizer: {
    level: "block",
    name: "details",
    start: (source) => source.search(detailsStart),
    tokenize: (source, _tokens, lexer) => {
      const head = open.exec(source);
      const body = source.slice(head?.[0].length);
      const close = head === null ? null : closing(body);

      return head === null || close === null
        ? undefined
        : {
            raw: source.slice(0, head[0].length + close.index + close.length),
            summary: unescapeHtml(head.groups?.["summary"] ?? "").replaceAll(
              /[\n\r]+/gu,
              " "
            ),
            tokens: lexer
              .blockTokens(body.slice(0, close.index))
              .map((child) =>
                child.type === "text" ? { ...child, type: "paragraph" } : child
              ),
            type: "details",
          };
    },
  },
  parseMarkdown: (token, helpers) => {
    const summary = String(token["summary"] ?? "").trim();

    const children = helpers.parseChildren(token.tokens ?? []);

    return helpers.createNode("details", undefined, [
      helpers.createNode(
        "detailsSummary",
        undefined,
        summary === "" ? [] : [{ text: summary, type: "text" }]
      ),
      helpers.createNode(
        "detailsContent",
        undefined,
        children.length === 0 ? [{ type: "paragraph" }] : children
      ),
    ]);
  },
  renderMarkdown: (node, helpers) => {
    const [summary, content] = node.content ?? [];

    const title = (summary?.content ?? [])
      .map((child: JSONContent) => child.text ?? "")
      .join("");

    const body = helpers.renderChildren(content?.content ?? [], "\n\n").trim();

    return [
      `<details>\n<summary>${escapeHtml(title)}</summary>`,
      body,
      "</details>",
    ]
      .filter((part) => part !== "")
      .join("\n\n");
  },
});

const svg = "http://www.w3.org/2000/svg";

const chevron = () => {
  const icon = document.createElementNS(svg, "svg");
  const path = document.createElementNS(svg, "path");

  for (const [name, value] of Object.entries({
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "2",
    viewBox: "0 0 24 24",
  })) {
    icon.setAttribute(name, value);
  }

  path.setAttribute("d", "m9 18 6-6-6-6");
  icon.append(path);

  return icon;
};

const literal = {
  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) =>
    helpers.createNode("paragraph", undefined, [
      { text: (token.raw ?? "").trim(), type: "text" },
    ]),
};

export const detailsExtensions = [
  MarkdownDetails.configure({
    persist: true,
    renderToggleButton: ({ element, isOpen }) => {
      if (element.firstChild === null) {
        element.append(chevron());
      }

      element.setAttribute("aria-expanded", String(isOpen));
      element.setAttribute("aria-label", isOpen ? "Collapse" : "Expand");
    },
  }),
  DetailsSummary.extend({
    ...literal,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("detailsSummaryPaste"),
          props: {
            handlePaste: (view, event) => {
              if (view.state.selection.$from.parent.type !== this.type) {
                return false;
              }

              const text = (event.clipboardData?.getData("text/plain") ?? "")
                .replaceAll(/\s+/gu, " ")
                .trim();

              view.dispatch(view.state.tr.insertText(text));

              return true;
            },
          },
        }),
      ];
    },
    marks: "",
  }),
  DetailsContent.extend(literal),
];

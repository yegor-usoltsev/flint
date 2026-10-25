import { Extension, Node, nodeInputRule } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { Paragraph } from "@tiptap/extension-paragraph";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { mediaHtml } from "~/lib/media-html";
import type { MediaAttributes, Tag } from "~/lib/media-html";
import { isSafeSource, mediaView } from "~/lib/media-view";

const maxWidth = 10_000;

const parseWidth = (value: string | null | undefined) => {
  const width = /^\d{1,5}$/u.test(value ?? "") ? Number(value) : 0;

  return width > 0 && width <= maxWidth ? width : null;
};

const decodeAttribute = (value: string) =>
  value
    .replaceAll(/&(?:quot|#34);/gu, '"')
    .replaceAll(/&(?:apos|#39);/gu, "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const nodeNames = { audio: "audio", img: "image", video: "video" } as const;

const openTag = /^ {0,3}<(?<tag>img|video|audio)(?=[\s/>])/iu;

const attributeName = /\s+(?<name>[\w-]+)/uy;

const attributeValue = /\s*=\s*(?<value>"[^"]*"|'[^']*'|[^\s"'=<>`]+)/uy;

const tagEnd = /\s*\/?>(?:\s*<\/(?<close>[a-z]+)\s*>)?[ \t]*(?:\n+|$)/iuy;

const mediaStart = /\n(?= {0,3}<(?:img|video|audio)\b)/giu;

const sticky = (pattern: RegExp, source: string, index: number) => {
  pattern.lastIndex = index;

  const match = pattern.exec(source);

  return match === null ? null : { end: pattern.lastIndex, match };
};

const readAttributes = (source: string, from: number) => {
  const attributes = new Map<string, string>();
  let index = from;
  let name = sticky(attributeName, source, index);

  while (name !== null) {
    const value = sticky(attributeValue, source, name.end);
    const quoted = value?.match.groups?.["value"] ?? "";
    const unquoted = /^["']/u.test(quoted) ? quoted.slice(1, -1) : quoted;

    attributes.set(
      name.match.groups?.["name"]?.toLowerCase() ?? "",
      decodeAttribute(unquoted)
    );
    index = value?.end ?? name.end;
    name = sticky(attributeName, source, index);
  }

  return { attributes, index };
};

const tags = new Set<string>(["audio", "img", "video"]);

const isTag = (tag: string): tag is Tag => tags.has(tag);

const matchMediaLine = (source: string) => {
  const open = openTag.exec(source);
  const tag = open?.groups?.["tag"]?.toLowerCase() ?? "";

  if (open === null || !isTag(tag)) {
    return null;
  }

  const { attributes, index } = readAttributes(source, open[0].length);
  const end = sticky(tagEnd, source, index);
  const close = end?.match.groups?.["close"]?.toLowerCase() ?? tag;

  return end === null || close !== tag
    ? null
    : { attributes, raw: source.slice(0, end.end), tag };
};

export const parseMediaLine = (source: string) => {
  const line = matchMediaLine(source);
  const src = line?.attributes.get("src")?.trim() ?? "";

  if (line === null || !isSafeSource(src)) {
    return null;
  }

  const { attributes, raw, tag } = line;

  const attrs: MediaAttributes =
    tag === "audio"
      ? { src }
      : { src, width: parseWidth(attributes.get("width")) };

  if (tag === "img") {
    attrs.alt = attributes.get("alt") ?? null;
  }

  return { attrs, name: nodeNames[tag], raw };
};

const MediaHtml = Extension.create({
  markdownTokenName: "mediaHtml",
  markdownTokenizer: {
    level: "block",
    name: "mediaHtml",
    start: (source) => {
      const line = [...source.matchAll(mediaStart)].find(
        ({ index }) => parseMediaLine(source.slice(index + 1)) !== null
      );

      return line === undefined ? -1 : line.index + 1;
    },
    tokenize: (source) => {
      const media = parseMediaLine(source);

      return media === null
        ? undefined
        : { media, raw: media.raw, type: "mediaHtml" };
    },
  },
  name: "mediaHtml",
  parseMarkdown: (token, helpers) => {
    // SAFETY: only the tokenizer above creates mediaHtml tokens.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Tiptap types custom token fields as any.
    const { attrs, name } = token["media"] as NonNullable<
      ReturnType<typeof parseMediaLine>
    >;

    return helpers.createNode(name, { ...attrs });
  },
});

const widthAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) =>
    parseWidth(element.getAttribute("width")),
};

const safeElement = (element: HTMLElement) =>
  isSafeSource(element.getAttribute("src") ?? "") && null;

const srcAttribute = {
  default: null,
  renderHTML: ({ src }: { src?: string | null }) =>
    isSafeSource(src ?? "") ? { src } : {},
};

const isSafeImage = (token: MarkdownToken) =>
  isSafeSource(String(token["href"] ?? "").trim());

// Tiptap lifts an image that fills a paragraph out of it; an unsafe one becomes text, which must stay inside the paragraph.
const MediaParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const [only, ...rest] = token.tokens ?? [];
    const unsafe = only?.type === "image" && !isSafeImage(only);

    return unsafe && rest.length === 0
      ? helpers.createNode("paragraph", undefined, helpers.parseInline([only]))
      : (this.parent?.(token, helpers) ?? []);
  },
});

const ImageAttributesSchema = v.object({
  alt: v.nullish(v.string()),
  src: v.nullish(v.string()),
  title: v.nullish(v.string()),
  width: v.nullish(v.number()),
});

const percentEncode = (char: string) =>
  `%${char.codePointAt(0)?.toString(16).toUpperCase().padStart(2, "0")}`;

// Tiptap writes alt, destination and title verbatim, so `]` in an alt or a space or `)` in a source broke the image on the next parse. Marked unescapes only `\[` and `\]` in an alt, so a backslash before a bracket or at the end cannot survive and is dropped.
const markdownImage = (alt: string, src: string, title?: string | null) => {
  const text = alt
    .replaceAll(/(?<!\\)\\+(?=[[\]]|$)/gu, "")
    .replaceAll(/[[\]]/gu, String.raw`\$&`);

  const destination = src.replaceAll(/[\s()<>]/gu, percentEncode);

  const quoted = (title ?? "").replaceAll(/["\\]/gu, String.raw`\$&`);
  const suffix = quoted === "" ? "" : ` "${quoted}"`;

  return `![${text}](${destination}${suffix})`;
};

const imageInput =
  /(?:^|\s)(?<markdown>!\[(?<alt>.+|:?)\]\((?<src>(?:https?:\/\/|\/(?!\/))\S+)(?:\s+["'](?<title>\S+)["'])?\))$/u;

const MediaImage = Image.extend({
  addAttributes: () => ({
    alt: { default: null },
    src: srcAttribute,
    title: { default: null },
    width: widthAttribute,
  }),
  addInputRules() {
    return [
      nodeInputRule({
        find: imageInput,
        getAttributes: ({ groups }) => ({
          alt: groups?.["alt"],
          src: groups?.["src"],
          title: groups?.["title"],
        }),
        type: this.type,
      }),
    ];
  },
  addNodeView: () => mediaView("img"),
  parseHTML: () => [{ getAttrs: safeElement, tag: "img[src]" }],
  parseMarkdown(token, helpers) {
    return isSafeImage(token)
      ? (this.parent?.(token, helpers) ?? [])
      : { text: token.raw ?? "", type: "text" };
  },
  renderMarkdown: (node: JSONContent) => {
    const attrs = v.parse(ImageAttributesSchema, node.attrs ?? {});
    const width = parseWidth(String(attrs.width ?? ""));

    return width === null
      ? markdownImage(attrs.alt ?? "", attrs.src ?? "", attrs.title)
      : mediaHtml("img", { ...attrs, width });
  },
});

const mediaNode = (tag: "audio" | "video") =>
  Node.create({
    addAttributes: () =>
      tag === "video"
        ? { src: srcAttribute, width: widthAttribute }
        : { src: srcAttribute },
    addNodeView: () => mediaView(tag),
    atom: true,
    draggable: true,
    group: "block",
    name: tag,
    parseHTML: () => [{ getAttrs: safeElement, tag: `${tag}[src]` }],
    renderHTML: ({ HTMLAttributes }) => [
      tag,
      { ...HTMLAttributes, controls: "", preload: "metadata" },
    ],
    renderMarkdown: (node: JSONContent) =>
      mediaHtml(tag, {
        src: String(node.attrs?.["src"] ?? ""),
        width: parseWidth(String(node.attrs?.["width"] ?? "")),
      }),
  });

export const mediaExtensions = [
  MediaParagraph,
  MediaImage,
  mediaNode("video"),
  mediaNode("audio"),
  MediaHtml,
];

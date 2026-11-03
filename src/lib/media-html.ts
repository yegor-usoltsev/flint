import type { Attachment } from "~/lib/api-types";

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export type Tag = "audio" | "img" | "video";

export interface MediaAttributes {
  alt?: string | null;
  src?: string | null;
  width?: number | null;
}

export const mediaHtml = (tag: Tag, { alt, src, width }: MediaAttributes) => {
  const parts = [`src="${escapeAttribute(src ?? "")}"`];

  if (tag === "img") {
    parts.push(`alt="${escapeAttribute(alt ?? "")}"`);
  } else {
    parts.push("controls");
  }

  if (tag !== "audio" && width !== null && width !== undefined) {
    parts.push(`width="${width}"`);
  }

  const open = `<${tag} ${parts.join(" ")}>`;

  return tag === "img" ? open : `${open}</${tag}>`;
};

const inlineImage = /^image\/(?!svg)/u;

export const isInlineImage = (attachment: Attachment) =>
  inlineImage.test(attachment.contentType);

export const mediaKind = ({ contentType }: Pick<Attachment, "contentType">) => {
  if (inlineImage.test(contentType)) {
    return "image";
  }

  if (contentType.startsWith("video/")) {
    return "video";
  }

  return contentType.startsWith("audio/") ? "audio" : null;
};

export const attachmentMarkdown = (attachment: Attachment) => {
  const name = attachment.filename.replaceAll(/[[\]\\]/gu, String.raw`\$&`);
  const kind = mediaKind(attachment);

  if (kind === "image") {
    return `![${name}](${attachment.url})`;
  }

  return kind === null
    ? `[${name}](${attachment.url})`
    : mediaHtml(kind, { src: attachment.url });
};

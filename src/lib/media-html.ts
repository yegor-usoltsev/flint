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

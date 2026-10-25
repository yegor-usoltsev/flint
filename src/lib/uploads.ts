// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { ApiError } from "~/lib/api";
import type { Attachment } from "~/lib/api-types";
import { mediaHtml } from "~/lib/media-html";

const ErrorBodySchema = v.object({
  error: v.object({ code: v.string(), message: v.string() }),
});

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

const failure = (request: XMLHttpRequest) => {
  const parsed = v.safeParse(ErrorBodySchema, request.response);

  return new ApiError(
    request.status,
    parsed.success
      ? parsed.output.error
      : { code: "http_error", message: `Upload failed: ${request.status}` }
  );
};

export const uploadFile = async (
  path: string,
  file: File,
  onProgress?: (fraction: number) => void
) =>
  // oxlint-disable-next-line promise/avoid-new -- fetch has no upload progress; XMLHttpRequest reports it through events.
  await new Promise<Attachment>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const form = new FormData();

    form.append("file", file);
    request.open("POST", `/api/v1${path}`);
    request.responseType = "json";

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded / event.total);
      }
    });

    request.addEventListener("load", () => {
      if (request.status === 201) {
        // SAFETY: the upload route answers 201 with an Attachment.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The API contract types the body.
        resolve(request.response as Attachment);
      } else {
        reject(failure(request));
      }
    });

    for (const type of ["abort", "error", "timeout"] as const) {
      request.addEventListener(type, () => {
        reject(new Error(`Could not upload ${file.name}`));
      });
    }

    request.send(form);
  });

const sizeFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export const formatBytes = (bytes: number) => {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${sizeFormat.format(value)} ${units[unit] ?? "B"}`;
};

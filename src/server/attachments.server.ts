// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Attachment, RealtimeEvent } from "~/lib/api-types";
import {
  isUuid,
  notFound,
  requireRole,
  requireWorkspace,
  userRef,
  workspaceRole,
} from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import {
  imageSides,
  normalizeImage,
  normalizedTypes,
} from "~/server/images.server";
import { findIssue, selectIssue } from "~/server/issues.server";
import { publish } from "~/server/realtime.server";
import { deleteObjects, s3 } from "~/server/s3.server";
import { findPageById } from "~/server/wiki.server";

const multipartOverhead = 64 * 1024;
const bufferedBytes = 16 * 1024 * 1024;

const inlineTypes = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "video/mp4",
  "video/ogg",
  "video/quicktime",
  "video/webm",
]);

const ForeignKeyViolationSchema = v.object({ errno: v.literal("23503") });

interface Target {
  issueId: string | null;
  pageId: string | null;
  projectId: string | null;
  workspaceId: string;
}

export type AttachmentTarget =
  | { issueKey: string }
  | { logoOf: string }
  | { pageId: string };

const findTarget = async (
  actor: Actor,
  target: AttachmentTarget
): Promise<Target> => {
  if ("issueKey" in target) {
    const issue = await findIssue(actor, target.issueKey);

    return {
      issueId: issue.id,
      pageId: null,
      projectId: issue.projectId,
      workspaceId: issue.workspaceId,
    };
  }

  if ("logoOf" in target) {
    const workspace = await requireWorkspace(actor, target.logoOf, "admin");

    return {
      issueId: null,
      pageId: null,
      projectId: null,
      workspaceId: workspace.id,
    };
  }

  const page = await findPageById(actor, target.pageId);

  return {
    issueId: null,
    pageId: page.id,
    projectId: null,
    workspaceId: page.workspaceId,
  };
};

const tooLarge = () =>
  new ApiError(
    413,
    "too_large",
    `Files are limited to ${env.MAX_UPLOAD_BYTES} bytes`
  );

const readFile = async (request: Request) => {
  const length = request.headers.get("content-length");

  if (length === null || !/^\d+$/u.test(length)) {
    throw new ApiError(411, "length_required", "Content-Length is required");
  }

  if (Number(length) > env.MAX_UPLOAD_BYTES + multipartOverhead) {
    throw tooLarge();
  }

  const form = await request.formData().catch(() => {
    throw new ApiError(
      400,
      "invalid_request",
      "Body must be multipart/form-data"
    );
  });

  const file = form.get("file");

  if (!(file instanceof File)) {
    throw new ApiError(400, "invalid_request", "Missing the file field");
  }

  if (file.size > env.MAX_UPLOAD_BYTES) {
    throw tooLarge();
  }

  return file;
};

const cleanFilename = (name: string) => {
  const base = name
    .replaceAll("%22", '"')
    .replace(/^.*[\\/]/u, "")
    .replaceAll(/\p{Cc}/gu, "");

  const trimmed = base.trim().slice(0, 200);

  return trimmed === "" ? "file" : trimmed;
};

const cleanContentType = (type: string) => {
  const essence = type.split(";")[0]?.trim().toLowerCase() ?? "";

  return /^[\w.+-]+\/[\w.+-]+$/u.test(essence)
    ? essence
    : "application/octet-stream";
};

let imageQueue: Promise<unknown> = Promise.resolve();

const serially = async <T>(task: () => Promise<T>) => {
  const result = imageQueue.then(task);

  imageQueue = result.catch(() => null);

  return await result;
};

const withExtension = (filename: string, extensions: readonly string[]) => {
  const extension = /\.[^.]*$/u.exec(filename)?.[0] ?? "";

  return extensions.includes(extension.toLowerCase())
    ? filename
    : `${filename.slice(0, filename.length - extension.length)}${extensions[0]}`;
};

const normalize = async (file: File, contentType: string, maxSide: number) => {
  const filename = cleanFilename(file.name);

  const image = normalizedTypes.has(contentType)
    ? await serially(
        async () => await normalizeImage(await file.bytes(), maxSide)
      )
    : null;

  return image === null
    ? { body: file, contentType, filename, normalized: false, size: file.size }
    : {
        body: image.data,
        contentType: image.type,
        filename: withExtension(filename, image.extensions),
        normalized: true,
        size: image.data.byteLength,
      };
};

const attachmentColumns = db`
  a.id, a.filename, a.content_type as "contentType",
  a.size_bytes::float8 as size, '/files/' || a.id as url,
  a.issue_id as "issueId", a.wiki_page_id as "pageId",
  a.created_at as "createdAt",
  ${userRef} as uploader
`;

const notifyChange = (target: Target, id: string) => {
  const event: RealtimeEvent = {
    entity: "attachment",
    id,
    projectId: target.projectId,
  };

  if (target.issueId !== null) {
    event.issueId = target.issueId;
  }

  if (target.pageId !== null) {
    event.pageId = target.pageId;
  }

  publish(target.workspaceId, event);
};

export const listAttachments = async (
  actor: Actor,
  attachmentTarget: AttachmentTarget
) => {
  const target = await findTarget(actor, attachmentTarget);

  return await db<Attachment[]>`
    select ${attachmentColumns}
    from attachments a join users u on u.id = a.uploader_id
    where a.issue_id is not distinct from ${target.issueId}::uuid
      and a.wiki_page_id is not distinct from ${target.pageId}::uuid
    order by a.created_at, a.id
  `;
};

export const uploadAttachment = async (
  actor: Actor,
  attachmentTarget: AttachmentTarget,
  request: Request
) => {
  const target = await findTarget(actor, attachmentTarget);

  if (target.issueId !== null) {
    const issue = await selectIssue(db, target.issueId);

    if (issue.deletedAt !== null) {
      throw new ApiError(409, "deleted", `${issue.key} is deleted`, issue);
    }
  }

  const file = await readFile(request);
  const id = Bun.randomUUIDv7();
  const key = `${target.workspaceId}/${id}`;
  const claimedType = cleanContentType(file.type);

  const logo = "logoOf" in attachmentTarget;

  const logoError = new ApiError(
    400,
    "invalid_request",
    "A logo must be a JPEG, PNG or WebP image"
  );

  if (logo && !normalizedTypes.has(claimedType)) {
    throw logoError;
  }

  const { body, contentType, filename, normalized, size } = await normalize(
    file,
    claimedType,
    logo ? imageSides.logo : imageSides.attachment
  );

  if (logo && !normalized) {
    throw logoError;
  }

  await s3.write(key, body, { type: contentType });

  try {
    await db`
      insert into attachments (
        id, workspace_id, issue_id, wiki_page_id, uploader_id, storage_key,
        filename, content_type, size_bytes
      ) values (
        ${id}, ${target.workspaceId}, ${target.issueId}, ${target.pageId},
        ${actor.userId}, ${key}, ${filename}, ${contentType}, ${size}
      )
    `;
  } catch (error) {
    await deleteObjects([key]);

    if (v.is(ForeignKeyViolationSchema, error)) {
      throw notFound(target.issueId === null ? "Wiki page" : "Issue");
    }

    throw error;
  }

  notifyChange(target, id);

  const [attachment] = await db<Attachment[]>`
    select ${attachmentColumns}
    from attachments a join users u on u.id = a.uploader_id
    where a.id = ${id}
  `;

  if (attachment === undefined) {
    throw notFound("File");
  }

  return attachment;
};

export const uploadFile = async (
  actor: Actor,
  target: AttachmentTarget,
  file: File
) => {
  const form = new FormData();

  form.append("file", file);

  const body = await new Response(form).blob();

  return await uploadAttachment(
    actor,
    target,
    new Request(env.APP_URL, {
      body,
      headers: {
        "content-length": String(body.size),
        "content-type": body.type,
      },
      method: "POST",
    })
  );
};

interface StoredFile extends Target {
  contentType: string;
  filename: string;
  size: number;
  storageKey: string;
}

const findFile = async (actor: Actor, id: string) => {
  const [file] = isUuid(id)
    ? await db<StoredFile[]>`
        select a.issue_id as "issueId", a.wiki_page_id as "pageId",
          i.project_id as "projectId",
          a.workspace_id as "workspaceId", a.content_type as "contentType",
          a.filename, a.size_bytes::float8 as size,
          a.storage_key as "storageKey"
        from attachments a
        left join issues i on i.id = a.issue_id
        where a.id = ${id}
      `
    : [];

  const role =
    file === undefined ? null : await workspaceRole(actor, file.workspaceId);

  if (file === undefined || role === null) {
    throw notFound("File");
  }

  return { ...file, role };
};

export const deleteAttachment = async (actor: Actor, id: string) => {
  const file = await findFile(actor, id);

  if (file.issueId === null && file.pageId === null) {
    requireRole(file.role, "admin");
  }

  await db`delete from attachments where id = ${id}`;
  await deleteObjects([file.storageKey]);
  notifyChange(file, id);
};

const asciiFallback = (filename: string) =>
  filename.replaceAll(/[^\u0020-\u007E]|["\\]/gu, "_");

const byteRange = (header: string | null, size: number) => {
  const match = /^bytes=(?<first>\d*)-(?<last>\d*)$/u.exec(header ?? "");

  if (match?.groups === undefined) {
    return null;
  }

  const { first = "", last = "" } = match.groups;

  if (first === "") {
    const start = Math.max(size - Number(last), 0);

    return last === "" || start >= size
      ? "unsatisfiable"
      : { end: size - 1, start };
  }

  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);

  return start > end ? "unsatisfiable" : { end, start };
};

export const downloadFile = async (
  actor: Actor,
  id: string,
  request: Request
) => {
  const file = await findFile(actor, id);
  const etag = `"${id}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      headers: { "Cache-Control": "private, no-cache", ETag: etag },
      status: 304,
    });
  }

  const disposition = inlineTypes.has(file.contentType)
    ? "inline"
    : "attachment";

  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "Content-Disposition": `${disposition}; filename="${asciiFallback(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "Content-Security-Policy":
      "default-src 'none'; media-src 'self'; sandbox allow-same-origin",
    "Content-Type": file.contentType,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };

  const range = byteRange(request.headers.get("range"), file.size);

  if (range === "unsatisfiable") {
    return new Response(null, {
      headers: { ...headers, "Content-Range": `bytes */${file.size}` },
      status: 416,
    });
  }

  const { end, start } = range ?? { end: file.size - 1, start: 0 };
  const length = end - start + 1;
  const object = s3.file(file.storageKey).slice(start, end + 1);

  const body =
    length <= bufferedBytes ? await object.arrayBuffer() : object.stream();

  const response = new Response(body, {
    headers: { ...headers, "Content-Length": String(length) },
    status: range === null ? 200 : 206,
  });

  if (range !== null) {
    response.headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
  }

  return response;
};

import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { Route as attachmentRoute } from "~/routes/api/v1/attachments/$attachmentId";
import { Route as issueAttachmentsRoute } from "~/routes/api/v1/issues/$issueKey/attachments";
import { Route as pageAttachmentsRoute } from "~/routes/api/v1/wiki/$pageId/attachments";
import { Route as logoRoute } from "~/routes/api/v1/workspaces/$slug/logo";
import { Route as fileRoute } from "~/routes/files/$fileId";
import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { createIssue, deleteIssue } from "~/server/issues.server";
import { addMember } from "~/server/members.server";
import { createProject } from "~/server/projects.server";
import { deleteObjects, s3 } from "~/server/s3.server";
import { deletePage, purgePage, putPage } from "~/server/wiki.server";
import { createWorkspace } from "~/server/workspaces.server";

import {
  appRequest,
  callApi,
  callRoute,
  createUser,
  resetDatabase,
  sessionCookieFor,
  stubGiteaUsers,
} from "../../test/helpers";

const storedKeys = async () => {
  const rows = await db<{ key: string }[]>`
    select storage_key as key from attachments
  `;

  return rows.map(({ key }) => key);
};

beforeEach(async () => {
  await deleteObjects(await storedKeys());
  await resetDatabase();
  stubGiteaUsers();
  env.MAX_UPLOAD_BYTES = 1000;
});

const savedMaxUpload = env.MAX_UPLOAD_BYTES;

afterEach(() => {
  mock.restore();
  env.MAX_UPLOAD_BYTES = savedMaxUpload;
});

const setup = async () => {
  const rootId = await createUser("root");
  const aliceId = await createUser("alice");
  const bobId = await createUser("bob");
  const root = { userId: rootId };

  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await createWorkspace(root, { name: "Globex", slug: "globex" });
  await addMember(root, "acme", { role: "member", username: "alice" });
  await addMember(root, "globex", { role: "member", username: "bob" });
  await createProject(root, "acme", { color: "blue", key: "ENG", name: "E" });
  await createIssue(root, "ENG", {
    assigneeId: null,
    description: "",
    labelIds: [],
    priority: 0,
    title: "Has files",
  });

  const page = await putPage(
    root,
    { path: "docs", slug: "acme" },
    { body: "" }
  );

  return {
    alice: await sessionCookieFor(aliceId),
    bob: await sessionCookieFor(bobId),
    page,
    root,
  };
};

const AttachmentSchema = v.looseObject({
  contentType: v.string(),
  filename: v.string(),
  id: v.string(),
  url: v.string(),
});

const multipart = async (file: File | null) => {
  const form = new FormData();

  if (file !== null) {
    form.set("file", file);
  }

  const body = await new Response(form).arrayBuffer();
  const [delimiter = ""] = new TextDecoder().decode(body).split("\r\n", 1);

  return {
    body,
    headers: {
      "content-length": String(body.byteLength),
      "content-type": `multipart/form-data; boundary=${delimiter.slice(2)}`,
    },
  };
};

const upload = async (auth: string, file: File | null, issueKey = "ENG-1") => {
  const { body, headers } = await multipart(file);

  const response = await callRoute(
    issueAttachmentsRoute,
    appRequest(`/api/v1/issues/${issueKey}/attachments`, {
      body,
      headers: { ...headers, cookie: auth, "sec-fetch-site": "same-origin" },
      method: "POST",
    }),
    { issueKey }
  );

  const json: unknown = await response.json();

  return { body: json, status: response.status };
};

const uploaded = async (auth: string, file: File) => {
  const response = await upload(auth, file);

  return v.parse(AttachmentSchema, response.body);
};

const download = async (
  auth: string,
  fileId: string,
  headers: Record<string, string> = {}
) =>
  await callRoute(
    fileRoute,
    appRequest(`/files/${fileId}`, { headers: { ...headers, cookie: auth } }),
    { fileId }
  );

const text = new TextEncoder().encode("notes\n");

const fixture = async (name: string) =>
  await Bun.file(`${import.meta.dir}/../../test/fixtures/${name}`).bytes();

const noisePng = await fixture("noise.png");

const resized = async (source: Uint8Array, width: number, height: number) =>
  Buffer.from(
    await new Bun.Image(source)
      .resize(width, height, { fit: "fill" })
      .png()
      .bytes()
  );

const png = await resized(noisePng, 1, 1);

test("upload, list and a browser-style download stream the file through the app", async () => {
  const { alice, bob } = await setup();

  const response = await upload(
    alice,
    new File([text], 'Заметки "1".txt', { type: "text/plain" })
  );

  expect(response).toMatchObject({
    body: {
      contentType: "text/plain",
      filename: 'Заметки "1".txt',
      pageId: null,
      size: 6,
      uploader: { username: "alice" },
    },
    status: 201,
  });

  const attachment = v.parse(AttachmentSchema, response.body);

  expect(attachment.url).toBe(`/files/${attachment.id}`);

  const list = await callApi(
    issueAttachmentsRoute,
    alice,
    "GET",
    "/api/v1/issues/ENG-1/attachments",
    { params: { issueKey: "ENG-1" } }
  );

  expect(list.body).toEqual([response.body]);

  const file = await download(alice, attachment.id);

  expect(file.status).toBe(200);
  expect(Object.fromEntries(file.headers)).toMatchObject({
    "cache-control": "private, no-cache",
    "content-disposition": `inline; filename="_______ _1_.txt"; filename*=UTF-8''${encodeURIComponent('Заметки "1".txt')}`,
    "content-length": "6",
    "content-security-policy":
      "default-src 'none'; media-src 'self'; sandbox allow-same-origin",
    "content-type": "text/plain",
    "x-content-type-options": "nosniff",
  });
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(text);

  const etag = file.headers.get("etag") ?? "";

  expect(etag).toBe(`"${attachment.id}"`);
  expect(
    await download(alice, attachment.id, { "if-none-match": etag })
  ).toMatchObject({ status: 304 });
  expect(
    await download(bob, attachment.id, { "if-none-match": etag })
  ).toMatchObject({ status: 404 });
});

test("a range request answers 206 with the requested bytes", async () => {
  const { alice } = await setup();
  const clip = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

  const attachment = await uploaded(
    alice,
    new File([clip], "clip.mp4", { type: "video/mp4" })
  );

  const part = await download(alice, attachment.id, { range: "bytes=2-4" });

  expect(part.status).toBe(206);
  expect(Object.fromEntries(part.headers)).toMatchObject({
    "accept-ranges": "bytes",
    "content-length": "3",
    "content-range": "bytes 2-4/8",
  });
  expect(part.headers.get("content-disposition")).toStartWith("inline;");
  expect(new Uint8Array(await part.arrayBuffer())).toEqual(clip.subarray(2, 5));

  const tail = await download(alice, attachment.id, { range: "bytes=-3" });

  expect(tail.headers.get("content-range")).toBe("bytes 5-7/8");
  expect(new Uint8Array(await tail.arrayBuffer())).toEqual(clip.subarray(5));

  const open = await download(alice, attachment.id, { range: "bytes=6-" });

  expect(open.headers.get("content-range")).toBe("bytes 6-7/8");

  const outside = await download(alice, attachment.id, { range: "bytes=8-" });

  expect(outside.status).toBe(416);
  expect(outside.headers.get("content-range")).toBe("bytes */8");

  const several = await download(alice, attachment.id, {
    range: "bytes=0-1,4-5",
  });

  expect(several.status).toBe(200);
});

test("active content downloads as an attachment and names lose their paths", async () => {
  const { alice } = await setup();

  const files = await Promise.all(
    [
      new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" }),
      new File(["<script>alert(1)</script>"], "../../evil.html", {
        type: "text/html; charset=utf-8",
      }),
      new File(["?"], "C:\\Users\\me\\blob", { type: "" }),
    ].map(async (file) => await uploaded(alice, file))
  );

  expect(
    files.map(({ contentType, filename }) => ({ contentType, filename }))
  ).toEqual([
    { contentType: "image/svg+xml", filename: "x.svg" },
    { contentType: "text/html", filename: "evil.html" },
    { contentType: "application/octet-stream", filename: "blob" },
  ]);

  const responses = await Promise.all(
    files.map(async ({ id }) => await download(alice, id))
  );

  expect(
    responses.map(
      (response) => response.headers.get("content-disposition")?.split(";")[0]
    )
  ).toEqual(["attachment", "attachment", "attachment"]);
});

const storedBytes = async (auth: string, id: string) => {
  const response = await download(auth, id);

  return await response.bytes();
};

const imageSize = async (bytes: Uint8Array) =>
  await new Bun.Image(bytes).metadata();

const hasExif = (bytes: Uint8Array) => Buffer.from(bytes).includes("Exif\0\0");

test("uploaded photos are oriented, stripped and re-encoded with their real type", async () => {
  const { alice } = await setup();

  env.MAX_UPLOAD_BYTES = 1_000_000;

  const photo = await fixture("oriented.jpg");

  expect(hasExif(photo)).toBe(true);

  const oriented = await uploaded(
    alice,
    new File([photo], "photo.JPEG", { type: "image/jpeg" })
  );

  expect(oriented).toMatchObject({
    contentType: "image/jpeg",
    filename: "photo.JPEG",
  });

  const stored = await storedBytes(alice, oriented.id);

  expect(await imageSize(stored)).toMatchObject({
    format: "jpeg",
    height: 40,
    width: 20,
  });
  expect(hasExif(stored)).toBe(false);

  const disguised = await upload(
    alice,
    new File([png], "shot.jpg", { type: "image/jpeg" })
  );

  const [row] = await db<{ size: number }[]>`
    select size_bytes::float8 as size from attachments
    where filename = 'shot.png'
  `;

  expect(disguised).toMatchObject({
    body: { contentType: "image/png", filename: "shot.png", size: row?.size },
    status: 201,
  });
});

test("an image that re-encoding would not shrink keeps its bytes", async () => {
  const { alice } = await setup();

  env.MAX_UPLOAD_BYTES = 1_000_000;

  const kept = await uploaded(
    alice,
    new File([noisePng], "noise.png", { type: "image/png" })
  );

  expect(await storedBytes(alice, kept.id)).toEqual(noisePng);
});

test("large images are scaled down to fit 2560 pixels", async () => {
  const { alice } = await setup();

  env.MAX_UPLOAD_BYTES = 1_000_000;

  const wide = await uploaded(
    alice,
    new File([await resized(png, 6000, 300)], "wide.png", { type: "image/png" })
  );

  expect(await imageSize(await storedBytes(alice, wide.id))).toMatchObject({
    format: "png",
    height: 128,
    width: 2560,
  });
});

const pngChunk = (type: string, data: Uint8Array) => {
  const chunk = Buffer.alloc(12 + data.length);

  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  chunk.set(data, 8);
  chunk.writeUInt32BE(
    Bun.hash.crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length
  );

  return chunk;
};

test("GIFs, SVGs, AVIFs and animations are stored untouched", async () => {
  const { alice } = await setup();
  const ihdrEnd = 8 + 12 + 13;

  const apng = Buffer.concat([
    png.subarray(0, ihdrEnd),
    pngChunk("acTL", new Uint8Array(8)),
    png.subarray(ihdrEnd),
  ]);

  const avif = new TextEncoder().encode("\0\0\0\u0018ftypavif\0\0\0\0avifmif1");

  const files = [
    new File([await fixture("animated.gif")], "a.gif", { type: "image/gif" }),
    new File([await fixture("animated.webp")], "a.webp", {
      type: "image/webp",
    }),
    new File([apng], "a.png", { type: "image/png" }),
    new File([avif], "a.avif", { type: "image/avif" }),
    new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }),
  ];

  const stored = await Promise.all(
    files.map(async (file) => {
      const { contentType, id } = await uploaded(alice, file);

      return { body: await storedBytes(alice, id), contentType };
    })
  );

  expect(stored).toEqual(
    await Promise.all(
      files.map(async (file) => ({
        body: await file.bytes(),
        contentType: file.type,
      }))
    )
  );
});

test("undecodable and oversized images are rejected", async () => {
  const { alice } = await setup();
  const huge = Buffer.from(png);

  huge.writeUInt32BE(20_000, 16);
  huge.writeUInt32BE(20_000, 20);
  huge.writeUInt32BE(Bun.hash.crc32(huge.subarray(12, 29)), 29);

  expect(
    await upload(alice, new File(["nope"], "x.png", { type: "image/png" }))
  ).toMatchObject({
    body: { error: { code: "invalid_request" } },
    status: 400,
  });
  expect(
    await upload(alice, new File([], "empty.png", { type: "image/png" }))
  ).toMatchObject({
    body: { error: { code: "invalid_request" } },
    status: 400,
  });
  expect(
    await upload(alice, new File([huge], "huge.png", { type: "image/png" }))
  ).toMatchObject({ body: { error: { code: "too_large" } }, status: 413 });
  expect(
    await upload(
      alice,
      new File([noisePng.subarray(0, 1000)], "cut.png", {
        type: "image/png",
      })
    )
  ).toMatchObject({
    body: { error: { code: "invalid_request" } },
    status: 400,
  });
  expect(await storedKeys()).toEqual([]);
});

test("the size limit and access are checked before the body is read", async () => {
  const { alice, bob } = await setup();
  let pulled = false;

  const lazyBody = () =>
    new ReadableStream(
      {
        pull: (controller) => {
          pulled = true;
          controller.close();
        },
      },
      { highWaterMark: 0 }
    );

  const post = async (auth: string, headers: Record<string, string>) => {
    const response = await callRoute(
      issueAttachmentsRoute,
      appRequest("/api/v1/issues/ENG-1/attachments", {
        body: lazyBody(),
        headers: { ...headers, cookie: auth, "sec-fetch-site": "same-origin" },
        method: "POST",
      }),
      { issueKey: "ENG-1" }
    );

    return response.status;
  };

  const multipartHeaders = {
    "content-type": "multipart/form-data; boundary=x",
  };

  expect(
    await post(alice, { ...multipartHeaders, "content-length": "1000000" })
  ).toBe(413);
  expect(await post(alice, multipartHeaders)).toBe(411);
  expect(await post(bob, { ...multipartHeaders, "content-length": "10" })).toBe(
    404
  );
  expect(pulled).toBe(false);

  expect(
    await upload(alice, new File([new Uint8Array(1001)], "big.bin"))
  ).toMatchObject({ body: { error: { code: "too_large" } }, status: 413 });
  expect(await upload(alice, null)).toMatchObject({ status: 400 });
  expect(await storedKeys()).toEqual([]);
});

test("a deleted issue lists its attachments but takes no uploads", async () => {
  const { alice, root } = await setup();
  const attachment = await uploaded(alice, new File([text], "kept.txt"));

  await deleteIssue(root, "ENG-1");

  const list = await callApi(
    issueAttachmentsRoute,
    alice,
    "GET",
    "/api/v1/issues/ENG-1/attachments",
    { params: { issueKey: "ENG-1" } }
  );

  expect(list).toMatchObject({ body: [{ id: attachment.id }], status: 200 });

  expect(await upload(alice, new File([text], "notes.txt"))).toMatchObject({
    body: { error: { code: "deleted", current: { key: "ENG-1" } } },
    status: 409,
  });
  expect(await storedKeys()).toHaveLength(1);
});

test("a failed S3 write leaves no row", async () => {
  const { alice } = await setup();

  spyOn(s3, "write").mockRejectedValue(new Error("S3 down"));

  expect(await upload(alice, new File(["x"], "x.txt"))).toMatchObject({
    status: 500,
  });
  expect(await storedKeys()).toEqual([]);
});

test("deleting an attachment or purging its wiki page removes the S3 object", async () => {
  const { alice, page, root } = await setup();
  const attachment = await uploaded(alice, new File(["a"], "a.txt"));
  const [key] = await storedKeys();

  expect(await s3.exists(key ?? "")).toBe(true);
  expect(
    await callApi(
      attachmentRoute,
      alice,
      "DELETE",
      `/api/v1/attachments/${attachment.id}`,
      { params: { attachmentId: attachment.id } }
    )
  ).toMatchObject({ status: 204 });
  expect(await s3.exists(key ?? "")).toBe(false);
  expect(await download(alice, attachment.id)).toMatchObject({ status: 404 });

  const { body, headers } = await multipart(new File(["b"], "b.txt"));

  const pageUpload = await callRoute(
    pageAttachmentsRoute,
    appRequest(`/api/v1/wiki/${page.id}/attachments`, {
      body,
      headers: { ...headers, cookie: alice, "sec-fetch-site": "same-origin" },
      method: "POST",
    }),
    { pageId: page.id }
  );

  expect(pageUpload.status).toBe(201);

  const [pageKey] = await storedKeys();

  await deletePage(root, "acme", "docs");
  expect(await s3.exists(pageKey ?? "")).toBe(true);

  await purgePage(root, page.id);
  expect(await storedKeys()).toEqual([]);
  expect(await s3.exists(pageKey ?? "")).toBe(false);
});

test("non-members cannot list, download or delete another workspace's files", async () => {
  const { alice, bob, page } = await setup();
  const attachment = await uploaded(alice, new File(["secret"], "s.txt"));

  const denied = await Promise.all([
    callApi(
      issueAttachmentsRoute,
      bob,
      "GET",
      "/api/v1/issues/ENG-1/attachments",
      { params: { issueKey: "ENG-1" } }
    ),
    callApi(
      pageAttachmentsRoute,
      bob,
      "GET",
      `/api/v1/wiki/${page.id}/attachments`,
      { params: { pageId: page.id } }
    ),
    callApi(
      attachmentRoute,
      bob,
      "DELETE",
      `/api/v1/attachments/${attachment.id}`,
      { params: { attachmentId: attachment.id } }
    ),
    download(bob, attachment.id),
    download(bob, "not-a-uuid"),
  ]);

  expect(denied.map(({ status }) => status)).toEqual([404, 404, 404, 404, 404]);

  const anonymous = await callRoute(
    fileRoute,
    appRequest(`/files/${attachment.id}`),
    { fileId: attachment.id }
  );

  expect(anonymous.status).toBe(401);

  const own = await download(alice, attachment.id);

  expect(await own.text()).toBe("secret");
});

const putLogo = async (auth: string, file: File) => {
  const { body, headers } = await multipart(file);

  const response = await callRoute(
    logoRoute,
    appRequest("/api/v1/workspaces/acme/logo", {
      body,
      headers: { ...headers, cookie: auth, "sec-fetch-site": "same-origin" },
      method: "PUT",
    }),
    { slug: "acme" }
  );

  const json: unknown = await response.json();

  return { body: json, status: response.status };
};

test("admins set, replace and remove a workspace logo image", async () => {
  const { alice, root } = await setup();

  env.MAX_UPLOAD_BYTES = 1_000_000;

  const image = new File([await resized(png, 1000, 500)], "logo.png", {
    type: "image/png",
  });

  const rootCookie = await sessionCookieFor(root.userId);

  expect(await putLogo(alice, image)).toMatchObject({ status: 403 });
  expect(
    await putLogo(
      rootCookie,
      new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })
    )
  ).toMatchObject({ status: 400 });
  expect(
    await putLogo(
      rootCookie,
      new File([await fixture("animated.gif")], "x.png", { type: "image/png" })
    )
  ).toMatchObject({ status: 400 });

  const first = await putLogo(rootCookie, image);
  const { logoUrl } = v.parse(v.object({ logoUrl: v.string() }), first.body);

  expect(first).toMatchObject({ body: { slug: "acme" }, status: 200 });
  const logoId = logoUrl.slice("/files/".length);
  const logo = await download(alice, logoId);

  expect(logo.status).toBe(200);
  expect(await imageSize(await logo.bytes())).toMatchObject({
    height: 128,
    width: 256,
  });
  expect(
    await callApi(
      attachmentRoute,
      alice,
      "DELETE",
      `/api/v1/attachments/${logoId}`,
      { params: { attachmentId: logoId } }
    )
  ).toMatchObject({ status: 403 });

  const [firstKey] = await storedKeys();

  await putLogo(rootCookie, image);
  expect(await s3.exists(firstKey ?? "")).toBe(false);
  expect(await storedKeys()).toHaveLength(1);

  expect(
    await callApi(
      logoRoute,
      rootCookie,
      "DELETE",
      "/api/v1/workspaces/acme/logo",
      {
        params: { slug: "acme" },
      }
    )
  ).toMatchObject({ body: { logoUrl: null }, status: 200 });
  expect(await storedKeys()).toEqual([]);
});

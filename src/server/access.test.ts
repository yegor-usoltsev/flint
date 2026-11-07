import { afterEach, beforeEach, expect, mock, test } from "bun:test";

import type { Endpoint } from "~/lib/endpoints";
import { Route as attachmentRoute } from "~/routes/api/v1/attachments/$attachmentId";
import { Route as commentRoute } from "~/routes/api/v1/comments/$commentId";
import { Route as activityRoute } from "~/routes/api/v1/issues/$issueKey/activity";
import { Route as issueAttachmentsRoute } from "~/routes/api/v1/issues/$issueKey/attachments";
import { Route as commentsRoute } from "~/routes/api/v1/issues/$issueKey/comments";
import { Route as issueRoute } from "~/routes/api/v1/issues/$issueKey/index";
import { Route as issueRestoreRoute } from "~/routes/api/v1/issues/$issueKey/restore";
import { Route as labelRoute } from "~/routes/api/v1/labels/$labelId";
import { Route as tokenRoute } from "~/routes/api/v1/me/tokens/$tokenId";
import { Route as tokensRoute } from "~/routes/api/v1/me/tokens/index";
import { Route as projectAttachmentsRoute } from "~/routes/api/v1/projects/$key/attachments";
import { Route as projectRoute } from "~/routes/api/v1/projects/$key/index";
import { Route as issueCountsRoute } from "~/routes/api/v1/projects/$key/issue-counts";
import { Route as projectIssuesRoute } from "~/routes/api/v1/projects/$key/issues";
import { Route as trashIssueRoute } from "~/routes/api/v1/trash/issues/$issueKey";
import { Route as trashPageRoute } from "~/routes/api/v1/trash/wiki/$pageId";
import { Route as pageAttachmentsRoute } from "~/routes/api/v1/wiki/$pageId/attachments";
import { Route as pageRoute } from "~/routes/api/v1/wiki/$pageId/index";
import { Route as moveRoute } from "~/routes/api/v1/wiki/$pageId/move";
import { Route as pageRestoreRoute } from "~/routes/api/v1/wiki/$pageId/restore";
import { Route as revisionRoute } from "~/routes/api/v1/wiki/$pageId/revisions/$revision/index";
import { Route as revisionRestoreRoute } from "~/routes/api/v1/wiki/$pageId/revisions/$revision/restore";
import { Route as revisionsRoute } from "~/routes/api/v1/wiki/$pageId/revisions/index";
import { Route as workspaceRoute } from "~/routes/api/v1/workspaces/$slug/index";
import { Route as workspaceIssuesRoute } from "~/routes/api/v1/workspaces/$slug/issues";
import { Route as labelsRoute } from "~/routes/api/v1/workspaces/$slug/labels";
import { Route as logoRoute } from "~/routes/api/v1/workspaces/$slug/logo";
import { Route as memberRoute } from "~/routes/api/v1/workspaces/$slug/members/$username";
import { Route as membersRoute } from "~/routes/api/v1/workspaces/$slug/members/index";
import { Route as presenceRoute } from "~/routes/api/v1/workspaces/$slug/presence";
import { Route as projectsRoute } from "~/routes/api/v1/workspaces/$slug/projects";
import { Route as searchRoute } from "~/routes/api/v1/workspaces/$slug/search";
import { Route as streamRoute } from "~/routes/api/v1/workspaces/$slug/stream";
import { Route as trashRoute } from "~/routes/api/v1/workspaces/$slug/trash";
import { Route as wikiPathRoute } from "~/routes/api/v1/workspaces/$slug/wiki/$";
import { Route as wikiRoute } from "~/routes/api/v1/workspaces/$slug/wiki/index";
import { Route as fileRoute } from "~/routes/files/$fileId";
import { uploadAttachment } from "~/server/attachments.server";
import { createComment } from "~/server/comments.server";
import { db } from "~/server/db.server";
import { createIssue, deleteIssue } from "~/server/issues.server";
import { addMember } from "~/server/members.server";
import { createProject } from "~/server/projects.server";
import { createToken } from "~/server/tokens.server";
import { deletePage, putPage } from "~/server/wiki.server";
import { createWorkspace } from "~/server/workspaces.server";

import {
  appRequest,
  callRoute,
  createUser,
  resetDatabase,
  sessionCookieFor,
  stubGiteaUsers,
} from "../../test/helpers";

beforeEach(async () => {
  await resetDatabase();
  stubGiteaUsers();
});

afterEach(() => {
  mock.restore();
});

type Route = Parameters<typeof callRoute>[0];

interface Call {
  body?: object;
  file?: true;
  params: Record<string, string>;
  query?: string;
  route: Route;
}

type ScopedEndpoint = Exclude<
  Endpoint,
  "GET /me" | "GET /me/tokens" | "GET /workspaces" | "POST /workspaces"
>;

const issueBody = {
  assigneeId: null,
  description: "",
  labelIds: [],
  priority: 0,
  title: "Secret",
} satisfies Parameters<typeof createIssue>[2];

const multipart = async () => {
  const form = new FormData();

  form.set("file", new File(["hello"], "notes.txt", { type: "text/plain" }));

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

const setup = async () => {
  const root = { userId: await createUser("root") };
  const alice = { userId: await createUser("alice") };
  const mallory = { userId: await createUser("mallory") };

  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await createWorkspace(mallory, { name: "Globex", slug: "globex" });
  await addMember(root, "acme", { role: "admin", username: "alice" });
  await addMember(mallory, "globex", { role: "member", username: "alice" });
  await createProject(root, "acme", { color: "blue", key: "ENG", name: "E" });

  const issue = await createIssue(root, "ENG", issueBody);
  const comment = await createComment(root, issue.key, { body: "hidden" });
  const trashed = await createIssue(root, "ENG", issueBody);

  await deleteIssue(root, trashed.key);

  const page = await putPage(root, { path: "plans", slug: "acme" }, {});
  const old = await putPage(root, { path: "old", slug: "acme" }, {});

  await deletePage(root, "acme", "old");

  const attachment = await uploadAttachment(
    root,
    { issueKey: issue.key },
    new Request("http://flint.test/upload", {
      ...(await multipart()),
      method: "POST",
    })
  );

  const [label] = await db<{ id: string }[]>`
    select l.id from labels l join workspaces w on w.id = l.workspace_id
    where w.slug = 'acme' limit 1
  `;

  const rootToken = await createToken(root, { name: "root" });

  const aliceGlobex = await createToken(alice, {
    name: "globex only",
    workspace: "globex",
  });

  return {
    aliceGlobex: `Bearer ${aliceGlobex.token}`,
    ids: {
      attachmentId: attachment.id,
      commentId: comment.id,
      issueKey: issue.key,
      labelId: label?.id ?? "",
      oldPageId: old.id,
      pageId: page.id,
      tokenId: rootToken.id,
      trashedKey: trashed.key,
    },
    alice: await sessionCookieFor(alice.userId),
    mallory: await sessionCookieFor(mallory.userId),
  };
};

type Ids = Awaited<ReturnType<typeof setup>>["ids"];

const scopedCalls = (ids: Ids): Record<ScopedEndpoint, Call> => {
  const slug = { slug: "acme" };
  const key = { key: "ENG" };
  const issueKey = { issueKey: ids.issueKey };
  const pageId = { pageId: ids.pageId };
  const revision = { ...pageId, revision: "1" };
  const wikiPath = { _splat: "plans", slug: "acme" };
  const member = { slug: "acme", username: "alice" };

  return {
    "DELETE /attachments/:attachmentId": {
      params: { attachmentId: ids.attachmentId },
      route: attachmentRoute,
    },
    "DELETE /comments/:commentId": {
      params: { commentId: ids.commentId },
      route: commentRoute,
    },
    "DELETE /issues/:issueKey": { params: issueKey, route: issueRoute },
    "DELETE /labels/:labelId": {
      params: { labelId: ids.labelId },
      route: labelRoute,
    },
    "DELETE /me/tokens/:tokenId": {
      params: { tokenId: ids.tokenId },
      route: tokenRoute,
    },
    "DELETE /projects/:key": { params: key, route: projectRoute },
    "DELETE /trash/issues/:issueKey": {
      params: { issueKey: ids.trashedKey },
      route: trashIssueRoute,
    },
    "DELETE /trash/wiki/:pageId": {
      params: { pageId: ids.oldPageId },
      route: trashPageRoute,
    },
    "DELETE /wiki/:pageId": { params: pageId, route: pageRoute },
    "DELETE /workspaces/:slug": { params: slug, route: workspaceRoute },
    "DELETE /workspaces/:slug/logo": { params: slug, route: logoRoute },
    "DELETE /workspaces/:slug/members/:username": {
      params: member,
      route: memberRoute,
    },
    "DELETE /workspaces/:slug/wiki/*": {
      params: wikiPath,
      route: wikiPathRoute,
    },
    "GET /comments/:commentId": {
      params: { commentId: ids.commentId },
      route: commentRoute,
    },
    "GET /issues/:issueKey": { params: issueKey, route: issueRoute },
    "GET /issues/:issueKey/activity": {
      params: issueKey,
      route: activityRoute,
    },
    "GET /issues/:issueKey/attachments": {
      params: issueKey,
      route: issueAttachmentsRoute,
    },
    "GET /issues/:issueKey/comments": {
      params: issueKey,
      route: commentsRoute,
    },
    "GET /projects/:key": { params: key, route: projectRoute },
    "GET /projects/:key/issue-counts": {
      params: key,
      route: issueCountsRoute,
    },
    "GET /projects/:key/issues": { params: key, route: projectIssuesRoute },
    "GET /wiki/:pageId": { params: pageId, route: pageRoute },
    "GET /wiki/:pageId/attachments": {
      params: pageId,
      route: pageAttachmentsRoute,
    },
    "GET /wiki/:pageId/revisions": { params: pageId, route: revisionsRoute },
    "GET /wiki/:pageId/revisions/:revision": {
      params: revision,
      route: revisionRoute,
    },
    "GET /workspaces/:slug": { params: slug, route: workspaceRoute },
    "GET /workspaces/:slug/issues": {
      params: slug,
      route: workspaceIssuesRoute,
    },
    "GET /workspaces/:slug/labels": { params: slug, route: labelsRoute },
    "GET /workspaces/:slug/members": { params: slug, route: membersRoute },
    "GET /workspaces/:slug/presence": { params: slug, route: presenceRoute },
    "GET /workspaces/:slug/projects": { params: slug, route: projectsRoute },
    "GET /workspaces/:slug/search": {
      params: slug,
      query: "?q=secret",
      route: searchRoute,
    },
    "GET /workspaces/:slug/trash": { params: slug, route: trashRoute },
    "GET /workspaces/:slug/wiki": { params: slug, route: wikiRoute },
    "GET /workspaces/:slug/wiki/*": { params: wikiPath, route: wikiPathRoute },
    "PATCH /comments/:commentId": {
      body: { body: "edited" },
      params: { commentId: ids.commentId },
      route: commentRoute,
    },
    "PATCH /issues/:issueKey": {
      body: { title: "Taken" },
      params: issueKey,
      route: issueRoute,
    },
    "PATCH /labels/:labelId": {
      body: { name: "Taken" },
      params: { labelId: ids.labelId },
      route: labelRoute,
    },
    "PATCH /projects/:key": {
      body: { name: "Taken" },
      params: key,
      route: projectRoute,
    },
    "PATCH /workspaces/:slug": {
      body: { name: "Taken" },
      params: slug,
      route: workspaceRoute,
    },
    "PATCH /workspaces/:slug/members/:username": {
      body: { role: "member" },
      params: member,
      route: memberRoute,
    },
    "PATCH /workspaces/:slug/wiki/*": {
      body: { append: "taken" },
      params: wikiPath,
      route: wikiPathRoute,
    },
    "POST /issues/:issueKey/attachments": {
      file: true,
      params: issueKey,
      route: issueAttachmentsRoute,
    },
    "POST /issues/:issueKey/comments": {
      body: { body: "spam" },
      params: issueKey,
      route: commentsRoute,
    },
    "POST /issues/:issueKey/restore": {
      params: { issueKey: ids.trashedKey },
      route: issueRestoreRoute,
    },
    "POST /me/tokens": {
      body: { name: "into acme", workspace: "acme" },
      params: {},
      route: tokensRoute,
    },
    "POST /projects/:key/attachments": {
      file: true,
      params: key,
      route: projectAttachmentsRoute,
    },
    "POST /projects/:key/issues": {
      body: issueBody,
      params: key,
      route: projectIssuesRoute,
    },
    "POST /wiki/:pageId/attachments": {
      file: true,
      params: pageId,
      route: pageAttachmentsRoute,
    },
    "POST /wiki/:pageId/move": {
      body: { path: "moved" },
      params: pageId,
      route: moveRoute,
    },
    "POST /wiki/:pageId/restore": {
      params: { pageId: ids.oldPageId },
      route: pageRestoreRoute,
    },
    "POST /wiki/:pageId/revisions/:revision/restore": {
      params: revision,
      route: revisionRestoreRoute,
    },
    "POST /workspaces/:slug/labels": {
      body: { color: "red", name: "Spam" },
      params: slug,
      route: labelsRoute,
    },
    "POST /workspaces/:slug/members": {
      body: { role: "admin", username: "mallory" },
      params: slug,
      route: membersRoute,
    },
    "POST /workspaces/:slug/projects": {
      body: { color: "red", key: "SPAM", name: "Spam" },
      params: slug,
      route: projectsRoute,
    },
    "PUT /workspaces/:slug/logo": {
      file: true,
      params: slug,
      route: logoRoute,
    },
    "POST /workspaces/:slug/presence": {
      body: { tab: ids.pageId, targetIds: [ids.pageId] },
      params: slug,
      route: presenceRoute,
    },
    "PUT /workspaces/:slug/wiki/*": {
      body: { body: "taken" },
      params: wikiPath,
      route: wikiPathRoute,
    },
  };
};

const allCalls = (ids: Ids): [string, Call][] => [
  ...Object.entries(scopedCalls(ids)),
  [
    "GET /workspaces/:slug/stream",
    { params: { slug: "acme" }, route: streamRoute },
  ],
  [
    "GET /files/:fileId",
    { params: { fileId: ids.attachmentId }, route: fileRoute },
  ],
];

const payload = async (
  call: Call
): Promise<{
  body: ArrayBuffer | string | null;
  headers: Record<string, string>;
}> => {
  if (call.file === true) {
    return await multipart();
  }

  return call.body === undefined
    ? { body: null, headers: {} }
    : {
        body: JSON.stringify(call.body),
        headers: { "content-type": "application/json" },
      };
};

const send = async (auth: string, endpoint: string, call: Call) => {
  const [method] = endpoint.split(" ");
  const { body, headers } = await payload(call);

  const credentials: Record<string, string> = auth.startsWith("Bearer ")
    ? { authorization: auth }
    : { cookie: auth, "sec-fetch-site": "same-origin" };

  const response = await callRoute(
    call.route,
    appRequest(`/api/v1/access${call.query ?? ""}`, {
      body,
      headers: { ...credentials, ...headers },
      method,
    }),
    call.params
  );

  return { endpoint, status: response.status, text: await response.text() };
};

const tables = [
  "api_token_workspaces",
  "api_tokens",
  "attachments",
  "comments",
  "invites",
  "issue_events",
  "issue_labels",
  "issues",
  "labels",
  "projects",
  "wiki_pages",
  "wiki_revisions",
  "workspace_members",
  "workspaces",
];

const snapshot = async () =>
  await Promise.all(
    tables.map(async (table) => {
      const [row] = await db<{ rows: unknown }[]>`
        select coalesce(jsonb_agg(to_jsonb(t) - 'last_used_at' order by t::text), '[]') as rows
        from ${db(table)} t
      `;

      return [table, row?.rows];
    })
  );

test.each([
  ["an admin of another workspace", "mallory"],
  ["a token restricted to another workspace", "aliceGlobex"],
] as const)(
  "every workspace endpoint answers 404 to %s and changes nothing",
  async (_who, credential) => {
    const context = await setup();
    const auth = context[credential];
    const before = await snapshot();

    const answers = await Promise.all(
      allCalls(context.ids).map(
        async ([endpoint, call]) => await send(auth, endpoint, call)
      )
    );

    expect(answers.filter(({ status }) => status !== 404)).toEqual([]);
    expect(
      answers.filter(({ text }) => !text.includes('"code":"not_found"'))
    ).toEqual([]);
    expect(await snapshot()).toEqual(before);
  }
);

test("the same reads succeed for an admin of the workspace", async () => {
  const { alice, ids } = await setup();

  const reads = allCalls(ids).filter(
    ([endpoint]) =>
      endpoint.startsWith("GET ") && endpoint !== "GET /workspaces/:slug/stream"
  );

  const answers = await Promise.all(
    reads.map(async ([endpoint, call]) => await send(alice, endpoint, call))
  );

  expect(answers.filter(({ status }) => status !== 200)).toEqual([]);
});

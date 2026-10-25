// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import type * as v from "valibot";

import type {
  ApiToken,
  Attachment,
  Comment,
  CreatedApiToken,
  Issue,
  IssueEvent,
  IssueSummary,
  Label,
  LabelSummary,
  Me,
  Member,
  ProjectSummary,
  ProjectDetail,
  SearchResults,
  StatusCount,
  Trash,
  WikiPage,
  WikiPageSummary,
  WikiRevision,
  WikiRevisionSummary,
  Workspace,
} from "~/lib/api-types";
import type {
  CreateCommentSchema,
  UpdateCommentSchema,
} from "~/server/comments.server";
import type {
  CreateIssueSchema,
  UpdateIssueSchema,
} from "~/server/issues.server";
import type {
  CreateLabelSchema,
  UpdateLabelSchema,
} from "~/server/labels.server";
import type {
  AddMemberSchema,
  UpdateMemberSchema,
} from "~/server/members.server";
import type {
  CreateProjectSchema,
  UpdateProjectSchema,
} from "~/server/projects.server";
import type { CreateTokenSchema } from "~/server/tokens.server";
import type {
  MovePageSchema,
  PatchPageSchema,
  PutPageSchema,
} from "~/server/wiki.server";
import type {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
} from "~/server/workspaces.server";

type In<Schema extends v.GenericSchema> = v.InferInput<Schema>;

type QueryValue = boolean | number | string | (number | string)[] | undefined;

type QueryMap = Partial<Record<string, QueryValue>>;

export interface IssueListQuery {
  assignee?: string[];
  closed?: boolean;
  label?: string[];
  limit?: number;
  offset?: number;
  priority?: (number | string)[];
  q?: string;
  status?: string[];
}

export interface SearchQuery {
  limit?: number;
  mode?: "fts" | "hybrid";
  q: string;
  type?: "all" | "issues" | "wiki";
}

export interface Endpoints {
  "DELETE /attachments/:attachmentId": { response: undefined };
  "DELETE /comments/:commentId": { response: undefined };
  "DELETE /issues/:issueKey": { response: Issue };
  "DELETE /labels/:labelId": { response: undefined };
  "DELETE /me/tokens/:tokenId": { response: undefined };
  "DELETE /projects/:key": { response: undefined };
  "DELETE /trash/issues/:issueKey": { response: undefined };
  "DELETE /trash/wiki/:pageId": { response: undefined };
  "DELETE /wiki/:pageId": { response: undefined };
  "DELETE /workspaces/:slug": { response: undefined };
  "DELETE /workspaces/:slug/logo": { response: Workspace };
  "DELETE /workspaces/:slug/members/:username": { response: undefined };
  "DELETE /workspaces/:slug/wiki/*": { response: undefined };
  "GET /issues/:issueKey": { response: Issue };
  "GET /issues/:issueKey/activity": { response: IssueEvent[] };
  "GET /issues/:issueKey/attachments": { response: Attachment[] };
  "GET /issues/:issueKey/comments": { response: Comment[] };
  "GET /me": { response: Me };
  "GET /me/tokens": { response: ApiToken[] };
  "GET /projects/:key": { response: ProjectDetail };
  "GET /projects/:key/issue-counts": {
    query: Omit<IssueListQuery, "closed" | "limit" | "offset">;
    response: StatusCount[];
  };
  "GET /projects/:key/issues": {
    query: IssueListQuery;
    response: IssueSummary[];
  };
  "GET /wiki/:pageId": { response: WikiPage };
  "GET /wiki/:pageId/attachments": { response: Attachment[] };
  "GET /wiki/:pageId/revisions": { response: WikiRevisionSummary[] };
  "GET /wiki/:pageId/revisions/:revision": { response: WikiRevision };
  "GET /workspaces": { response: Workspace[] };
  "GET /workspaces/:slug": { response: Workspace };
  "GET /workspaces/:slug/issues": {
    query: IssueListQuery;
    response: IssueSummary[];
  };
  "GET /workspaces/:slug/labels": { response: LabelSummary[] };
  "GET /workspaces/:slug/members": { response: Member[] };
  "GET /workspaces/:slug/projects": { response: ProjectSummary[] };
  "GET /workspaces/:slug/search": {
    query: SearchQuery;
    response: SearchResults;
  };
  "GET /workspaces/:slug/trash": { response: Trash };
  "GET /workspaces/:slug/wiki": {
    query: { prefix?: string };
    response: WikiPageSummary[];
  };
  "GET /workspaces/:slug/wiki/*": { response: WikiPage };
  "PATCH /comments/:commentId": {
    body: In<typeof UpdateCommentSchema>;
    response: Comment;
  };
  "PATCH /issues/:issueKey": {
    body: In<typeof UpdateIssueSchema>;
    response: Issue;
  };
  "PATCH /labels/:labelId": {
    body: In<typeof UpdateLabelSchema>;
    response: Label;
  };
  "PATCH /projects/:key": {
    body: In<typeof UpdateProjectSchema>;
    response: ProjectDetail;
  };
  "PATCH /workspaces/:slug": {
    body: In<typeof UpdateWorkspaceSchema>;
    response: Workspace;
  };
  "PATCH /workspaces/:slug/members/:username": {
    body: In<typeof UpdateMemberSchema>;
    response: Member;
  };
  "PATCH /workspaces/:slug/wiki/*": {
    body: In<typeof PatchPageSchema>;
    response: WikiPage;
  };
  "POST /issues/:issueKey/attachments": {
    body: FormData;
    response: Attachment;
  };
  "POST /issues/:issueKey/comments": {
    body: In<typeof CreateCommentSchema>;
    response: Comment;
  };
  "POST /issues/:issueKey/restore": { response: Issue };
  "POST /me/tokens": {
    body: In<typeof CreateTokenSchema>;
    response: CreatedApiToken;
  };
  "POST /projects/:key/issues": {
    body: In<typeof CreateIssueSchema>;
    response: Issue;
  };
  "POST /wiki/:pageId/attachments": { body: FormData; response: Attachment };
  "POST /wiki/:pageId/move": {
    body: In<typeof MovePageSchema>;
    response: WikiPage;
  };
  "POST /wiki/:pageId/restore": { response: WikiPage };
  "POST /wiki/:pageId/revisions/:revision/restore": { response: WikiPage };
  "POST /workspaces": {
    body: In<typeof CreateWorkspaceSchema>;
    response: Workspace;
  };
  "POST /workspaces/:slug/labels": {
    body: In<typeof CreateLabelSchema>;
    response: Label;
  };
  "POST /workspaces/:slug/members": {
    body: In<typeof AddMemberSchema>;
    response: Member;
  };
  "POST /workspaces/:slug/projects": {
    body: In<typeof CreateProjectSchema>;
    response: ProjectDetail;
  };
  "PUT /workspaces/:slug/logo": { body: FormData; response: Workspace };
  "PUT /workspaces/:slug/wiki/*": {
    body: In<typeof PutPageSchema>;
    response: WikiPage;
  };
}

export type Endpoint = keyof Endpoints;

type PathOf<E extends Endpoint> = E extends `${string} ${infer Path}`
  ? Path
  : never;

type ParamNames<Path extends string> =
  Path extends `${infer Head}/${infer Tail}`
    ? ParamNames<Head> | ParamNames<Tail>
    : Path extends `:${infer Name}`
      ? Name
      : Path extends "*"
        ? "_splat"
        : never;

export type Params<E extends Endpoint> = Record<ParamNames<PathOf<E>>, string>;

export type Body<E extends Endpoint> = Endpoints[E] extends {
  body: infer Value;
}
  ? Value
  : undefined;

export type Query<E extends Endpoint> = Endpoints[E] extends {
  query: infer Value extends object;
}
  ? Value
  : undefined;

export type ResponseOf<E extends Endpoint> = Endpoints[E]["response"];

export type RequestOptions<E extends Endpoint> = (ParamNames<
  PathOf<E>
> extends never
  ? { params?: undefined }
  : { params: Params<E> }) &
  (Body<E> extends undefined ? { body?: undefined } : { body: Body<E> }) &
  (Query<E> extends undefined ? { query?: undefined } : { query?: Query<E> });

export const endpointPath = (
  endpoint: Endpoint,
  params?: Record<string, string>,
  // oxlint-disable-next-line anti-slop/no-object-parameters -- Query types are interfaces, which lack the index signature of `QueryMap`.
  query: object = {}
) => {
  const pattern = endpoint.slice(endpoint.indexOf(" ") + 1);

  const path = pattern
    .split("/")
    .map((segment) => {
      if (segment === "*") {
        return (params?.["_splat"] ?? "")
          .split("/")
          .map(encodeURIComponent)
          .join("/");
      }

      return segment.startsWith(":")
        ? encodeURIComponent(params?.[segment.slice(1)] ?? "")
        : segment;
    })
    .join("/");

  const search = new URLSearchParams();

  // SAFETY: every query type in `Endpoints` holds only `QueryValue` fields.
  for (const [name, value] of Object.entries(query as QueryMap)) {
    for (const item of [value].flat()) {
      if (item !== undefined) {
        search.append(name, String(item));
      }
    }
  }

  const suffix = search.size === 0 ? "" : `?${search.toString()}`;

  return {
    method: endpoint.slice(0, endpoint.indexOf(" ")),
    path: path + suffix,
  };
};

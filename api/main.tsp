import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";
import "@typespec/events";
import "@typespec/sse";

using Http;
using OpenAPI;

/** Prototype slice of the Flint REST API (FLN-6). The full API lives in src/lib/endpoints.ts. */
@service(#{ title: "Flint API" })
@info(#{ version: "0.0.5", license: #{ name: "MIT", identifier: "MIT" } })
@server("{origin}/api/v1", "A Flint instance", { origin: url = "http://localhost:4700" })
@useAuth(BearerAuth)
namespace Flint;

@format("uuid")
scalar Uuid extends string;

/** An issue key such as ENG-12, matched case-insensitively. */
scalar IssueKey extends string;

/** A project key such as ENG, matched case-insensitively. */
scalar ProjectKey extends string;

/** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
@extension("x-go-type", "int")
union Priority {
  0,
  1,
  2,
  3,
  4,
}

union CommitStatusState {
  "error",
  "failure",
  "pending",
  "skipped",
  "success",
  "warning",
}

union PullRequestState {
  "closed",
  "draft",
  "merged",
  "open",
}

/** A pull request state, or `deleted` for a removed branch. */
union GitLinkState {
  "closed",
  "deleted",
  "draft",
  "merged",
  "open",
}

union GitLinkKind {
  "branch",
  "commit",
  "pull_request",
}

/** Trimmed before validation, so whitespace-only titles are rejected. */
@minLength(1)
@maxLength(500)
@pattern("\\S")
scalar Title extends string;

@maxLength(200000)
scalar Description extends string;

/** A fractional index key; the server also checks that it is well formed. */
@maxLength(100)
@pattern("^[0-9A-Za-z]+$")
scalar SortKey extends string;

model CommitCheck {
  context: string;
  description: string;
  state: CommitStatusState;
  targetUrl: string;
  updatedAt: utcDateTime;
}

model GitLink {
  authorLogin: string | null;
  checks: CommitCheck[];
  ciState: CommitStatusState | null;
  externalId: string;
  headSha: string | null;
  id: Uuid;
  kind: GitLinkKind;
  occurredAt: utcDateTime;
  repo: string;
  repoUrl: string;
  state: GitLinkState | null;
  title: string;
  url: string;
}

model IssueSummary {
  assigneeId: Uuid | null;
  canceledAt: utcDateTime | null;
  checklistDone: int32;
  checklistTotal: int32;
  ciState: CommitStatusState | null;
  completedAt: utcDateTime | null;
  createdAt: utcDateTime;
  creatorId: Uuid;
  id: Uuid;
  key: string;
  labelIds: Uuid[];
  number: int32;
  priority: Priority;
  projectId: Uuid;
  pullRequestState: PullRequestState | null;
  sortKey: string;
  statusId: Uuid;
  title: string;
  updatedAt: utcDateTime;
  version: int32;
}

model Issue {
  ...IssueSummary;
  deletedAt: utcDateTime | null;
  description: string;
  links: GitLink[];
}

/** Fields left out stay unchanged; `assigneeId: null` unassigns. */
model UpdateIssue {
  assigneeId?: Uuid | null;
  description?: Description;
  addLabelIds?: Uuid[];
  labelIds?: Uuid[];
  priority?: Priority;
  removeLabelIds?: Uuid[];
  sortKey?: SortKey;
  statusId?: Uuid;
  title?: Title;

  /** The version the change is based on; a stale one answers 409 with the current issue. */
  @minValue(1)
  version?: int32;
}

model RealtimeEvent {
  entity:
    | "attachment"
    | "comment"
    | "issue"
    | "label"
    | "member"
    | "project"
    | "wiki"
    | "workspace";
  id: Uuid;
  issueId?: Uuid;
  pageId?: Uuid;
  projectId: Uuid | null;
}

model UserRef {
  avatarUrl: string;
  displayName: string;
  id: Uuid;
  username: string;
}

model Attachment {
  contentType: string;
  createdAt: utcDateTime;
  filename: string;
  id: Uuid;
  issueId: Uuid | null;
  pageId: Uuid | null;
  size: integer;
  uploader: UserRef;
  url: string;
}

model ErrorDetail {
  /** A stable machine-readable code such as `not_found` or `invalid_request`. */
  code: string;

  message: string;
}

model IssueConflictDetail {
  ...OmitProperties<ErrorDetail, "code">;
  code: "conflict" | "deleted" | "user_changed";

  /** The issue as it is now, so the client can rebase its change. */
  current?: Issue;
}

@error
model ApiError {
  error: ErrorDetail;
}

@error
model BadRequestError {
  @statusCode _: 400;
  error: ErrorDetail;
}

@error
model UnauthorizedError {
  @statusCode _: 401;
  error: ErrorDetail;
}

/** Also answered for resources outside the caller's workspaces. */
@error
model NotFoundError {
  @statusCode _: 404;
  error: ErrorDetail;
}

@error
model IssueConflictError {
  @statusCode _: 409;
  error: IssueConflictDetail;
}

alias Errors = BadRequestError | UnauthorizedError | NotFoundError | ApiError;

@route("/issues/{issueKey}")
interface Issues {
  @get
  @operationId("getIssue")
  @summary("Get an issue")
  get(@path issueKey: IssueKey): Issue | Errors;

  @patch
  @operationId("updateIssue")
  @summary("Change an issue")
  update(@path issueKey: IssueKey, @body changes: UpdateIssue): Issue | IssueConflictError | Errors;
}

@route("/issues/{issueKey}/attachments")
interface IssueAttachments {
  @post
  @operationId("uploadIssueAttachment")
  @summary("Attach a file to an issue")
  upload(
    @path issueKey: IssueKey,
    @header contentType: "multipart/form-data",
    @multipartBody body: {
      file: HttpPart<File>;
    },
  ): {
    @statusCode _: 201;
    @body attachment: Attachment;
  } | Errors;
}

@route("/projects/{key}/issues")
interface ProjectIssues {
  @get
  @operationId("listProjectIssues")
  @summary("List a project's issues")
  list(
    @path key: ProjectKey,

    /** Usernames; `none` matches unassigned issues. */
    @query(#{ explode: true }) assignee?: string[],

    /** Include completed and canceled issues. */
    @query closed?: boolean,

    /** Label names. */
    @query(#{ explode: true }) label?: string[],

    @query @minValue(1) @maxValue(200) limit?: int32,
    @query @minValue(0) @maxValue(1000000) offset?: int32,

    /** Numbers 0-4 or names: none, urgent, high, medium, low. */
    @query(#{ explode: true }) priority?: string[],

    @query @maxLength(200) q?: string,

    /** Status names. */
    @query(#{ explode: true }) status?: string[],
  ): IssueSummary[] | Errors;
}

@Events.events
union WorkspaceEvents {
  RealtimeEvent,
}

@route("/workspaces/{slug}/stream")
interface WorkspaceStream {
  /** Server-sent events: each `data:` line holds one RealtimeEvent; the first chunk is a comment. */
  #suppress "@typespec/openapi3/streams-not-supported" "OpenAPI 3.1 has no itemSchema; generators skip this operation."
  @get
  @operationId("streamWorkspace")
  @summary("Stream workspace changes")
  stream(@path slug: string): SSE.SSEStream<WorkspaceEvents> | Errors;
}

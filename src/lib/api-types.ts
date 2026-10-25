import type { Color } from "~/lib/colors";
import type { Priority } from "~/lib/priorities";
import type { ProjectIcon } from "~/lib/project-icons";

export type Role = "admin" | "member";

export type StatusCategory =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export interface ApiErrorBody {
  error: { code: string; current?: unknown; message: string };
}

export interface Me {
  avatarUrl: string;
  displayName: string;
  email: string;
  giteaUrl: string;
  id: string;
  isInstanceAdmin: boolean;
  trashDays: number;
  username: string;
  workspaces: Workspace[];
}

export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
}

export interface Workspace extends WorkspaceRef {
  color: Color;
  logoUrl: string | null;
  role: Role;
}

export interface Member {
  avatarUrl: string;
  displayName: string;
  joinedAt: string;
  pending: boolean;
  role: Role;
  userId: string | null;
  username: string;
}

export interface Project {
  color: Color;
  icon: ProjectIcon;
  id: string;
  key: string;
  name: string;
  workspaceSlug: string;
}

export interface Status {
  category: StatusCategory;
  color: Color;
  id: string;
  name: string;
  position: number;
}

export interface ProjectSummary extends Project {
  createdAt: string;
  openIssues: number;
}

export interface ProjectDetail extends Project {
  statuses: Status[];
}

export interface Label {
  color: Color;
  id: string;
  name: string;
}

export interface LabelSummary extends Label {
  issueCount: number;
}

export interface ApiToken {
  createdAt: string;
  id: string;
  lastUsedAt: string | null;
  name: string;
  prefix: string;
  workspaces: WorkspaceRef[] | null;
}

export interface CreatedApiToken extends ApiToken {
  token: string;
}

export interface UserRef {
  avatarUrl: string;
  displayName: string;
  id: string;
  username: string;
}

export type PullRequestState = "closed" | "draft" | "merged" | "open";

export type CommitStatusState =
  | "error"
  | "failure"
  | "pending"
  | "skipped"
  | "success"
  | "warning";

export interface CommitCheck {
  context: string;
  description: string;
  state: CommitStatusState;
  targetUrl: string;
  updatedAt: string;
}

export interface GitLink {
  authorLogin: string | null;
  checks: CommitCheck[];
  ciState: CommitStatusState | null;
  externalId: string;
  headSha: string | null;
  id: string;
  kind: "branch" | "commit" | "pull_request";
  occurredAt: string;
  repo: string;
  repoUrl: string;
  state: PullRequestState | "deleted" | null;
  title: string;
  url: string;
}

export interface StatusCount {
  count: number;
  statusId: string;
}

export interface IssueSummary {
  assigneeId: string | null;
  canceledAt: string | null;
  checklistDone: number;
  checklistTotal: number;
  ciState: CommitStatusState | null;
  completedAt: string | null;
  createdAt: string;
  creatorId: string;
  id: string;
  key: string;
  labelIds: string[];
  number: number;
  priority: Priority;
  projectId: string;
  pullRequestState: PullRequestState | null;
  sortKey: string;
  statusId: string;
  title: string;
  updatedAt: string;
  version: number;
}

export interface Issue extends IssueSummary {
  deletedAt: string | null;
  description: string;
  links: GitLink[];
}

export interface Comment {
  author: UserRef;
  body: string;
  createdAt: string;
  editedAt: string | null;
  id: string;
  issueId: string;
  version: number;
  viaApi: boolean;
}

export type IssueEventKind =
  | "assignee"
  | "comment_created"
  | "comment_deleted"
  | "comment_edited"
  | "created"
  | "deleted"
  | "description"
  | "label_added"
  | "label_removed"
  | "priority"
  | "restored"
  | "status"
  | "title";

export type IssueEventValue = number | string | null;

export interface IssueEvent {
  actor: UserRef | null;
  createdAt: string;
  fromValue: IssueEventValue;
  id: string;
  kind: IssueEventKind;
  toValue: IssueEventValue;
  viaApi: boolean;
}

export type WikiNodeKind = "folder" | "page";

export interface WikiPageSummary {
  id: string;
  kind: WikiNodeKind;
  path: string;
  revision: number;
  sortKey: string;
  title: string;
  updatedAt: string;
}

export interface TrashedIssue {
  deletedAt: string;
  deletedBy: UserRef | null;
  id: string;
  key: string;
  projectId: string;
  purgeAt: string;
  title: string;
}

export interface TrashedPage {
  deletedAt: string;
  deletedBy: UserRef | null;
  descendants: number;
  id: string;
  kind: WikiNodeKind;
  path: string;
  purgeAt: string;
  title: string;
}

export interface Trash {
  issues: TrashedIssue[];
  pages: TrashedPage[];
}

export interface WikiPage extends WikiPageSummary {
  body: string;
  createdAt: string;
  updatedBy: UserRef;
  workspaceSlug: string;
}

export interface WikiRevisionSummary {
  author: UserRef;
  createdAt: string;
  revision: number;
  title: string;
  updatedAt: string;
  viaApi: boolean;
}

export interface WikiRevision extends WikiRevisionSummary {
  body: string;
}

export interface WikiPageHit {
  id: string;
  path: string;
  score: number;
  title: string;
  updatedAt: string;
}

export type IssueHit = IssueSummary & { score: number };

export interface SearchResults {
  issues: IssueHit[];
  pages: WikiPageHit[];
  semantic: boolean;
}

export interface Attachment {
  contentType: string;
  createdAt: string;
  filename: string;
  id: string;
  issueId: string | null;
  pageId: string | null;
  size: number;
  uploader: UserRef;
  url: string;
}

export type RealtimeEntity =
  | "attachment"
  | "comment"
  | "issue"
  | "label"
  | "member"
  | "project"
  | "wiki"
  | "workspace";

export interface RealtimeEvent {
  entity: RealtimeEntity;
  id: string;
  issueId?: string;
  pageId?: string;
  projectId: string | null;
}

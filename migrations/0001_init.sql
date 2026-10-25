create extension if not exists vector;

create table users (
  id uuid primary key,
  gitea_id text not null unique,
  username text not null,
  name text not null default '',
  display_name text generated always as (
    coalesce(nullif(btrim(name), ''), username)
  ) stored,
  email text not null default '',
  avatar_url text not null default '',
  is_instance_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_username_idx on users (lower(username));

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index sessions_user_idx on sessions (user_id);

create table workspaces (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  color text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table api_tokens (
  id uuid primary key,
  user_id uuid not null references users on delete cascade,
  name text not null,
  restricted boolean not null default false,
  token_hash text not null unique,
  prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index api_tokens_user_idx on api_tokens (user_id);

create table api_token_workspaces (
  token_id uuid not null references api_tokens on delete cascade,
  workspace_id uuid not null references workspaces on delete cascade,
  primary key (token_id, workspace_id)
);

create index api_token_workspaces_workspace_idx
  on api_token_workspaces (workspace_id);

create table workspace_members (
  workspace_id uuid not null references workspaces on delete cascade,
  user_id uuid not null references users on delete cascade,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on workspace_members (user_id);

create table invites (
  id uuid primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  gitea_id text not null,
  gitea_username text not null,
  role text not null check (role in ('admin', 'member')),
  created_by uuid not null references users,
  created_at timestamptz not null default now(),
  unique (workspace_id, gitea_id)
);

create unique index invites_workspace_username_idx on invites (
  workspace_id, lower(gitea_username)
);

create index invites_gitea_id_idx on invites (gitea_id);

create table projects (
  id uuid primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  key text not null unique check (key ~ '^[A-Z][A-Z0-9]{1,4}$'),
  name text not null,
  icon text not null,
  color text not null,
  issue_counter integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_workspace_idx on projects (workspace_id);

create table statuses (
  id uuid primary key,
  project_id uuid not null references projects on delete cascade,
  name text not null,
  category text not null check (
    category in ('backlog', 'unstarted', 'started', 'completed', 'canceled')
  ),
  color text not null,
  position integer not null,
  created_at timestamptz not null default now()
);

create index statuses_project_idx on statuses (project_id, position);

create table labels (
  id uuid primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  color text not null,
  created_at timestamptz not null default now()
);

create unique index labels_workspace_name_idx on labels (
  workspace_id, lower(name)
);

create table issues (
  id uuid primary key,
  project_id uuid not null references projects on delete cascade,
  number integer not null,
  title text not null,
  description_md text not null default '',
  status_id uuid not null references statuses,
  priority smallint not null default 0 check (priority between 0 and 4),
  assignee_id uuid references users,
  creator_id uuid not null references users,
  sort_key text collate "C" not null,
  checklist_done integer not null default 0,
  checklist_total integer not null default 0,
  completed_at timestamptz,
  canceled_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references users,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', title), 'A')
    || setweight(to_tsvector('english', description_md), 'B')
  ) stored,
  embedding vector(1024),
  embedding_model text,
  embedding_hash text,
  unique (project_id, number)
);

create index issues_board_idx on issues (project_id, status_id, sort_key, id);
create index issues_assignee_idx on issues (assignee_id) where deleted_at is null;
create index issues_trash_idx on issues (deleted_at) where deleted_at is not null;
create index issues_search_idx on issues using gin (search);
create index issues_embedding_idx on issues
  using hnsw (embedding vector_cosine_ops);

create table issue_labels (
  issue_id uuid not null references issues on delete cascade,
  label_id uuid not null references labels on delete cascade,
  primary key (issue_id, label_id)
);

create index issue_labels_label_idx on issue_labels (label_id);

create table comments (
  id uuid primary key,
  issue_id uuid not null references issues on delete cascade,
  author_id uuid not null references users,
  via_token_id uuid references api_tokens on delete set null,
  body_md text not null,
  version integer not null default 1,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index comments_issue_idx on comments (issue_id, created_at);

create table issue_events (
  id uuid primary key,
  issue_id uuid not null references issues on delete cascade,
  actor_id uuid references users,
  via_token_id uuid references api_tokens on delete set null,
  kind text not null,
  from_value jsonb,
  to_value jsonb,
  created_at timestamptz not null default now()
);

create index issue_events_issue_idx on issue_events (issue_id, created_at);

create table wiki_pages (
  id uuid primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  kind text not null check (kind in ('page', 'folder')),
  path text collate "C" not null,
  sort_key text collate "C" not null,
  title text not null,
  body_md text not null default '',
  revision integer not null default 1,
  updated_by uuid not null references users,
  deleted_at timestamptz,
  deleted_by uuid references users,
  deleted_with uuid references wiki_pages on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', title), 'A')
    || setweight(to_tsvector('english', body_md), 'B')
  ) stored,
  embedding vector(1024),
  embedding_model text,
  embedding_hash text,
  check (kind = 'page' or body_md = '')
);

create unique index wiki_pages_path_key on wiki_pages (workspace_id, path)
  where deleted_at is null;
create index wiki_pages_trash_idx on wiki_pages (workspace_id, deleted_at)
  where deleted_at is not null;
create index wiki_pages_deleted_with_idx on wiki_pages (deleted_with)
  where deleted_with is not null;

create index wiki_pages_search_idx on wiki_pages using gin (search);
create index wiki_pages_embedding_idx on wiki_pages
  using hnsw (embedding vector_cosine_ops);

create table wiki_revisions (
  page_id uuid not null references wiki_pages on delete cascade,
  revision integer not null,
  title text not null,
  body_md text not null,
  author_id uuid not null references users,
  via_token_id uuid references api_tokens on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (page_id, revision)
);

create table attachments (
  id uuid primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  issue_id uuid references issues on delete cascade,
  wiki_page_id uuid references wiki_pages on delete cascade,
  uploader_id uuid not null references users,
  storage_key text not null unique,
  filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(issue_id, wiki_page_id) <= 1)
);

create index attachments_workspace_idx on attachments (workspace_id);
create index attachments_issue_idx on attachments (issue_id);
create index attachments_wiki_page_idx on attachments (wiki_page_id);

alter table workspaces
  add column logo_attachment_id uuid references attachments on delete set null;

create table git_links (
  id uuid primary key,
  issue_id uuid not null references issues on delete cascade,
  kind text not null check (kind in ('commit', 'branch', 'pull_request')),
  repo_full_name text not null,
  repo_url text not null,
  external_id text not null,
  ref text,
  url text not null,
  title text not null default '',
  state text check (state in ('open', 'draft', 'merged', 'closed', 'deleted')),
  head_sha text,
  author_login text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, kind, repo_full_name, external_id)
);

create table commit_statuses (
  repo_full_name text not null,
  sha text not null,
  context text not null,
  state text not null check (
    state in ('pending', 'success', 'error', 'failure', 'warning', 'skipped')
  ),
  target_url text not null default '',
  description text not null default '',
  gitea_id bigint not null,
  updated_at timestamptz not null,
  primary key (repo_full_name, sha, context)
);

create table pull_request_snapshots (
  repo_full_name text not null,
  number text not null,
  updated_at timestamptz not null,
  primary key (repo_full_name, number)
);

create table webhook_deliveries (
  delivery_id text primary key,
  event text not null,
  status text not null,
  error text,
  received_at timestamptz not null default now()
);

create table legacy_invites (
  workspace_id uuid not null references workspaces on delete cascade,
  gitea_username text not null,
  role text not null check (role in ('admin', 'member')),
  created_by uuid references users on delete set null,
  created_at timestamptz not null
);

insert into legacy_invites (
  workspace_id, gitea_username, role, created_by, created_at
)
select workspace_id, gitea_username, role, created_by, created_at
from invites;

delete from invites;

alter table invites add column gitea_id text not null;

create unique index invites_gitea_id_workspace_idx on invites (
  gitea_id, workspace_id
);

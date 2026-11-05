delete from invites;

alter table invites add column gitea_id text not null;

create unique index invites_gitea_id_workspace_idx on invites (
  gitea_id, workspace_id
);

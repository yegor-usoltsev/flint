alter table workspaces
  add column gitea_repositories text[] not null default '{}';

alter table git_links add column repo_private boolean not null default true;

update workspaces w set gitea_repositories = array(
  select distinct g.repo_full_name
  from git_links g
  join issues i on i.id = g.issue_id
  join projects p on p.id = i.project_id
  where p.workspace_id = w.id
  order by g.repo_full_name
);

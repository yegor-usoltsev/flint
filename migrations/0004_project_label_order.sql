alter table projects add column position integer not null default 0;
alter table labels add column position integer not null default 0;

update projects p set position = o.position
from (
  select id, row_number() over (
    partition by workspace_id order by lower(name), key
  ) - 1 as position
  from projects
) o
where o.id = p.id;

update labels l set position = o.position
from (
  select id, row_number() over (
    partition by workspace_id order by lower(name)
  ) - 1 as position
  from labels
) o
where o.id = l.id;

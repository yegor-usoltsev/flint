alter table sessions add column legacy_cookie boolean not null default false;

update sessions set legacy_cookie = true;

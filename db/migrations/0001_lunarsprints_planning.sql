-- LunarSprints planning schema for plain PostgreSQL.
-- Ported from the original planning migration. Changes from the original:
--   * ls_users replaces the hosted auth user table. Every user_id points to it.
--   * The signed-in user is read from the transaction setting app.user_id,
--     which the server sets in src/lib/db.ts (withUser). The browser never sets it.
--   * The app connects as ls_app (not the owner, no superuser, no BYPASSRLS).
--     Row Level Security is enabled AND forced on every ls_ table.
-- Roles ls_owner and ls_app are created by scripts/db-setup.ts before this runs.

create table public.ls_users (
 id uuid primary key default gen_random_uuid(),
 firebase_uid text unique not null,
 email text,
 created_at timestamptz not null default now(),
 last_sign_in_at timestamptz
);

create table public.ls_sprints (
 id uuid primary key,
 user_id uuid not null references public.ls_users(id) on delete cascade,
 revision integer not null check (revision >= 0),
 state jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (state->>'id' = id::text),
 check ((state->>'revision')::integer = revision),
 check (state->>'stage' in ('intention','select','clarify','goals','stories','schedule','review','active')),
 check ((state->>'endDate')::date = (state->>'startDate')::date + 14)
);
create index ls_sprints_owner_updated on public.ls_sprints(user_id,updated_at desc);
create table public.ls_revisions (
 sprint_id uuid not null references public.ls_sprints(id) on delete cascade,
 user_id uuid not null references public.ls_users(id) on delete cascade,
 revision integer not null,
 state jsonb not null,
 action text not null,
 request_hash text not null,
 created_at timestamptz not null default now(),
 primary key(sprint_id,revision)
);
create index ls_revisions_owner on public.ls_revisions(user_id,sprint_id);
create table public.ls_commands (
 user_id uuid not null references public.ls_users(id) on delete cascade,
 idempotency_key uuid not null,
 sprint_id uuid not null references public.ls_sprints(id) on delete cascade,
 request_hash text not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(user_id,idempotency_key)
);
create index ls_commands_sprint on public.ls_commands(sprint_id);
create table public.ls_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.ls_users(id) on delete cascade,
 sprint_id uuid not null references public.ls_sprints(id) on delete cascade,
 action text not null,
 revision integer not null,
 approved_hash text,
 actor_type text not null default 'user' check(actor_type='user'),
 created_at timestamptz not null default now()
);
create index ls_events_owner_sprint on public.ls_events(user_id,sprint_id,created_at);
create table public.ls_agent_runs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.ls_users(id) on delete cascade,
 sprint_id uuid not null references public.ls_sprints(id) on delete cascade,
 role text not null,
 resource_id text not null,
 session_id text,
 turn_id text,
 status text not null check(status in ('ok','error')),
 duration_ms integer not null,
 error_code text,
 created_at timestamptz not null default now()
);
create index ls_agent_runs_owner on public.ls_agent_runs(user_id,sprint_id,created_at);
create table public.ls_rate_limits (
 user_id uuid not null references public.ls_users(id) on delete cascade,
 bucket text not null,
 window_start timestamptz not null,
 count integer not null,
 primary key(user_id,bucket)
);

alter table public.ls_users enable row level security;
alter table public.ls_users force row level security;
alter table public.ls_sprints enable row level security;
alter table public.ls_sprints force row level security;
alter table public.ls_revisions enable row level security;
alter table public.ls_revisions force row level security;
alter table public.ls_commands enable row level security;
alter table public.ls_commands force row level security;
alter table public.ls_events enable row level security;
alter table public.ls_events force row level security;
alter table public.ls_agent_runs enable row level security;
alter table public.ls_agent_runs force row level security;
alter table public.ls_rate_limits enable row level security;
alter table public.ls_rate_limits force row level security;

-- Every policy is scoped to the user named in app.user_id. When it is not set,
-- the expression is null and no row matches.
create policy ls_users_read_own on public.ls_users for select to ls_app
 using (id = (select nullif(current_setting('app.user_id', true), '')::uuid));
-- Only the two sign-in functions below (owned by ls_owner) write ls_users.
create policy ls_users_owner_functions on public.ls_users for all to ls_owner
 using (true) with check (true);

create policy ls_sprints_read_own on public.ls_sprints for select to ls_app
 using (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));
create policy ls_sprints_insert_own on public.ls_sprints for insert to ls_app
 with check (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));
create policy ls_sprints_update_own on public.ls_sprints for update to ls_app
 using (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid))
 with check (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));

create policy ls_revisions_read_own on public.ls_revisions for select to ls_app
 using (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));
create policy ls_revisions_insert_own on public.ls_revisions for insert to ls_app
 with check (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));

create policy ls_commands_read_own on public.ls_commands for select to ls_app
 using (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));
create policy ls_commands_insert_own on public.ls_commands for insert to ls_app
 with check (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));

create policy ls_events_read_own on public.ls_events for select to ls_app
 using (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));
create policy ls_events_insert_own on public.ls_events for insert to ls_app
 with check (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));

create policy ls_agent_runs_read_own on public.ls_agent_runs for select to ls_app
 using (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));
create policy ls_agent_runs_insert_own on public.ls_agent_runs for insert to ls_app
 with check (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));

create policy ls_rate_limits_read_own on public.ls_rate_limits for select to ls_app
 using (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));
create policy ls_rate_limits_insert_own on public.ls_rate_limits for insert to ls_app
 with check (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));
create policy ls_rate_limits_update_own on public.ls_rate_limits for update to ls_app
 using (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid))
 with check (user_id = (select nullif(current_setting('app.user_id', true), '')::uuid));

revoke all on public.ls_users, public.ls_sprints, public.ls_revisions, public.ls_commands, public.ls_events, public.ls_agent_runs, public.ls_rate_limits from public;
grant select on public.ls_users to ls_app;
grant select, insert, update on public.ls_sprints to ls_app;
grant select, insert on public.ls_revisions, public.ls_commands, public.ls_events, public.ls_agent_runs to ls_app;
grant select, insert, update on public.ls_rate_limits to ls_app;

-- Sign-in bookkeeping. These run as the owner so the server can find or create
-- the ls_users row for a verified Firebase account before app.user_id is known.
-- They touch only ls_users and return only the internal id.
create function public.ls_sign_in(p_firebase_uid text, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
 if coalesce(p_firebase_uid, '') = '' then raise exception 'invalid_identity' using errcode='P0001'; end if;
 insert into public.ls_users(firebase_uid, email, last_sign_in_at) values (p_firebase_uid, p_email, now())
 on conflict (firebase_uid) do update set email = excluded.email, last_sign_in_at = now()
 returning id into result;
 return result;
end; $$;
create function public.ls_user_id(p_firebase_uid text)
returns uuid language sql stable security definer set search_path = '' as $$
 select id from public.ls_users where firebase_uid = p_firebase_uid
$$;
revoke all on function public.ls_sign_in(text,text) from public;
revoke all on function public.ls_user_id(text) from public;
grant execute on function public.ls_sign_in(text,text) to ls_app;
grant execute on function public.ls_user_id(text) to ls_app;

-- Atomic command boundary. Runs with the caller's rights (ls_app), so every
-- read and write below is checked by the policies above.
create function public.ls_commit(p_user uuid,p_sprint uuid,p_expected integer,p_key uuid,p_request_hash text,p_action text,p_state jsonb,p_approved_hash text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare old_revision integer; prior public.ls_commands%rowtype;
begin
 if p_user is distinct from nullif(current_setting('app.user_id', true), '')::uuid then raise exception 'identity_mismatch' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));
 select * into prior from public.ls_commands where user_id=p_user and idempotency_key=p_key;
 if found then
  if prior.request_hash<>p_request_hash then raise exception 'idempotency_conflict' using errcode='P0001'; end if;
  return prior.result;
 end if;
 if p_state->>'id'<>p_sprint::text or (p_state->>'revision')::integer<>p_expected+1 then raise exception 'invalid_revision' using errcode='P0001'; end if;
 if p_expected=-1 then
  if p_action<>'create' or p_state->>'stage'<>'intention' then raise exception 'invalid_create'; end if;
  insert into public.ls_sprints(id,user_id,revision,state) values(p_sprint,p_user,0,p_state) on conflict do nothing;
  if not found then raise exception 'stale_revision' using errcode='P0001'; end if;
 else
  select revision into old_revision from public.ls_sprints where id=p_sprint and user_id=p_user for update;
  if not found then raise exception 'not_found' using errcode='P0001'; end if;
  if old_revision<>p_expected then raise exception 'stale_revision' using errcode='P0001'; end if;
  update public.ls_sprints set revision=p_expected+1,state=p_state,updated_at=now() where id=p_sprint and user_id=p_user;
 end if;
 insert into public.ls_revisions(sprint_id,user_id,revision,state,action,request_hash) values(p_sprint,p_user,p_expected+1,p_state,p_action,p_request_hash);
 insert into public.ls_events(user_id,sprint_id,revision,action,approved_hash) values(p_user,p_sprint,p_expected+1,p_action,p_approved_hash);
 insert into public.ls_commands(user_id,idempotency_key,sprint_id,request_hash,result) values(p_user,p_key,p_sprint,p_request_hash,p_state);
 return p_state;
end; $$;
revoke all on function public.ls_commit(uuid,uuid,integer,uuid,text,text,jsonb,text) from public;
grant execute on function public.ls_commit(uuid,uuid,integer,uuid,text,text,jsonb,text) to ls_app;

create function public.ls_claim_rate(p_user uuid,p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare entry public.ls_rate_limits%rowtype;
begin
 if p_user is distinct from nullif(current_setting('app.user_id', true), '')::uuid then raise exception 'identity_mismatch' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_bucket,1));
 select * into entry from public.ls_rate_limits where user_id=p_user and bucket=p_bucket for update;
 if not found then
  insert into public.ls_rate_limits values(p_user,p_bucket,now(),1); return true;
 elsif entry.window_start<now()-make_interval(secs=>p_seconds) then
  update public.ls_rate_limits set window_start=now(),count=1 where user_id=p_user and bucket=p_bucket; return true;
 elsif entry.count>=p_limit then return false;
 else
  update public.ls_rate_limits set count=count+1 where user_id=p_user and bucket=p_bucket; return true;
 end if;
end; $$;
revoke all on function public.ls_claim_rate(uuid,text,integer,integer) from public;
grant execute on function public.ls_claim_rate(uuid,text,integer,integer) to ls_app;

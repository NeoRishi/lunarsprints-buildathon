-- Isolated, additive schema. Application writes are server-only; authenticated
-- clients may read their own aggregates and immutable revision history via RLS.
create table public.ls_sprints (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
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
 user_id uuid not null references auth.users(id) on delete cascade,
 revision integer not null,
 state jsonb not null,
 action text not null,
 request_hash text not null,
 created_at timestamptz not null default now(),
 primary key(sprint_id,revision)
);
create index ls_revisions_owner on public.ls_revisions(user_id,sprint_id);
create table public.ls_commands (
 user_id uuid not null references auth.users(id) on delete cascade,
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
 user_id uuid not null references auth.users(id) on delete cascade,
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
 user_id uuid not null references auth.users(id) on delete cascade,
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
 user_id uuid not null references auth.users(id) on delete cascade,
 bucket text not null,
 window_start timestamptz not null,
 count integer not null,
 primary key(user_id,bucket)
);

alter table public.ls_sprints enable row level security;
alter table public.ls_revisions enable row level security;
alter table public.ls_commands enable row level security;
alter table public.ls_events enable row level security;
alter table public.ls_agent_runs enable row level security;
alter table public.ls_rate_limits enable row level security;
create policy ls_sprints_read_own on public.ls_sprints for select to authenticated using ((select auth.uid())=user_id);
create policy ls_revisions_read_own on public.ls_revisions for select to authenticated using ((select auth.uid())=user_id);
create policy ls_events_read_own on public.ls_events for select to authenticated using ((select auth.uid())=user_id);
create policy ls_agent_runs_read_own on public.ls_agent_runs for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.ls_sprints, public.ls_revisions, public.ls_commands, public.ls_events, public.ls_agent_runs, public.ls_rate_limits from anon, authenticated;
grant select on public.ls_sprints, public.ls_revisions, public.ls_events, public.ls_agent_runs to authenticated;
grant all on public.ls_sprints, public.ls_revisions, public.ls_commands, public.ls_events, public.ls_agent_runs, public.ls_rate_limits to service_role;

create function public.ls_commit(p_user uuid,p_sprint uuid,p_expected integer,p_key uuid,p_request_hash text,p_action text,p_state jsonb,p_approved_hash text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare old_revision integer; prior public.ls_commands%rowtype; result_state jsonb;
begin
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
revoke all on function public.ls_commit(uuid,uuid,integer,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.ls_commit(uuid,uuid,integer,uuid,text,text,jsonb,text) to service_role;

create function public.ls_claim_rate(p_user uuid,p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare entry public.ls_rate_limits%rowtype;
begin
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
revoke all on function public.ls_claim_rate(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.ls_claim_rate(uuid,text,integer,integer) to service_role;

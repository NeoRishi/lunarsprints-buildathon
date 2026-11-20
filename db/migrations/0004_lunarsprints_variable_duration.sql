-- Allow sprints of 3 to 45 inclusive calendar days instead of exactly 15.
-- Scope: ls_sprints only. Existing 15-day rows already satisfy the new rule,
-- so no data is rewritten. This relaxes one check; it removes no table,
-- column, policy, grant or row.
do $$
declare constraint_name text;
begin
  select c.conname into constraint_name
  from pg_constraint c
  where c.conrelid = 'public.ls_sprints'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%endDate%'
    and pg_get_constraintdef(c.oid) like '%14%';
  if constraint_name is not null then
    execute format('alter table public.ls_sprints drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.ls_sprints
  add constraint ls_sprints_window_check check (
    ((state->>'endDate')::date - (state->>'startDate')::date) between 2 and 44
  );

-- Supports counting a user's active sprints when plan limits are enforced.
create index if not exists ls_sprints_owner_stage
  on public.ls_sprints (user_id, (state->>'stage'));

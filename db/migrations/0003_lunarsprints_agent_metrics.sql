-- Add aggregate usage only; never store prompts, credentials or provider headers.
alter table public.ls_agent_runs
  add column metrics jsonb not null default '{}'::jsonb
  constraint ls_agent_runs_metrics_object check (jsonb_typeof(metrics) = 'object');
comment on column public.ls_agent_runs.metrics is 'Per-session model, token counts and timing. Empty object means historical or unavailable metrics. Existing owner RLS and write grants apply.';

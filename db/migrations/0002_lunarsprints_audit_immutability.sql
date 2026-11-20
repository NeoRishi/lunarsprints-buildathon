-- Even the application role may only append to audit and idempotency history.
-- Ported unchanged except for the role name (ls_app replaces the hosted
-- service role). ls_app was never granted these rights in 0001; this revoke
-- keeps the rule explicit so a later grant cannot quietly loosen it.
revoke update,delete,truncate on public.ls_revisions,public.ls_events,public.ls_commands,public.ls_agent_runs from ls_app;

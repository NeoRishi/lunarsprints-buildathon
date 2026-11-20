-- Even the application service role may only append to audit/idempotency history.
revoke update,delete,truncate on public.ls_revisions,public.ls_events,public.ls_commands,public.ls_agent_runs from service_role;

# P0 clarification recovery, October 31, 2026

The approved P0 scope is implemented: reproduce the fragmented-book failure, preserve and resume specialist clarification, and establish scope readiness and canonical planning facts.

## Behavior

- A valid `needs_clarification` envelope now becomes a saved question instead of a missing-field error. The question, choices, reply and resume target survive reloads.
- Existing goal approval stays intact while the user answers. Scope-changing continuation produces a goal proposal requiring explicit reapproval before work generation.
- Agent 03 checks scope readiness separately from provisional feasibility. Legacy approved goals are checked before decomposition; new model proposals include scoped readiness evidence.
- The user can provide context, select a choice, or explicitly say the scope is unknown. An unknown-scope continuation proposes a bounded discovery milestone for review. It does not claim the original outcome is complete.
- Canonical facts resolve selected answer IDs into their actual wording with source and certainty. Time answers remain estimates until the user explicitly confirms an editable numeric budget.
- Time confirmation preserves reviewed work and dates. It invalidates schedule approval when required and never changes an active budget outside approved replanning.
- More than five questions requires specific continuation consent before the extra question is displayed/answered. No options are preselected. An unanswered saved question cannot trigger repeated generation.
- Active guidance can also ask a question without changing work/progress. Unknown execution context is not treated as a request for a discovery goal.

## Verification

The original regression failed before implementation because the specialist question escaped as an exception. Offline tests cover the response decoder, preserved approval, reload-safe replies, option/custom validation, unknown/discovery behavior, scope reapproval, stale questions/plans, continuation consent, canonical facts, availability and active-guidance safety.

`docs/evidence/clarification-recovery.json` records real saved Agents 03/05/07 calls, an explicitly synthetic legacy snapshot, custom scope answers, new SMART approval, generated stories/tasks/subtasks, scheduling, activation and persistent board. The second synthetic case produced an unapproved discovery proposal. Browser checks used Playwright because the Browser plugin was unavailable: 1440×1000 and 390×844, no page/console errors or horizontal overflow. The test checked that the real user's sprint was unchanged.

`docs/evidence/p0-final-discovery.json` records the final explicit-discovery and sixth-question consent branch using a previously generated synthetic question and one new Agent 03 call. It does not replay a real user's information into a QA account.

Final command outputs, test counts, source fingerprint and synchronization checks are in `docs/evidence/final-validation.json`.

## Continuing the user's saved sprint

Refresh the existing local application. From Work breakdown, request generation again. The missing-scope check now presents a question rather than the camelCase field error. Provide the intended scope, or choose “I don’t know yet” and request a bounded discovery proposal. Review and approve the updated SMART proposal before generating work. Earlier answers and the original outcome remain saved. Availability can be explicitly confirmed or remain labeled unknown.

No real goal, answer, approval or user data was rewritten by QA. No schema migration, saved-agent mutation, duplicate agent, Auth/OAuth/SMTP configuration change or public deployment was performed. The existing LifeOS project remains active. P1 cost/latency optimization and broader planning/release hardening remain separate work.

# P2: scheduling and planning reliability

Scope: the remaining deterministic scheduler/deadline/dependency refinements and adversarial planning regressions after P1. Public deployment, a durable background worker, client-visible streaming, production budget caps and full data erasure remain separate work.

## Changes

- Every allocation must be within its goal's deadline as well as the 15-day sprint. Capacity-risk acknowledgment cannot override a deadline or a zero-minute rest day.
- Placement propagates successor deadlines back through prerequisites, orders competing stories by the resulting deadline before their reviewed priority, and retains the reviewed task order inside each story. Story prerequisites still require separate calendar dates.
- The scheduler first uses daily capacity after buffer, then remaining daily capacity. It does not silently overfill a day, split tasks, extend dates, or rewrite dependencies. When no slot fits, it saves an actionable conflict with the affected goal/story/task and recovery options.
- Conflict recovery preserves reviewed goals, work, approvals and any last saved allocation. Users can correct availability and retry, return to edit work/task sizes, or amend/reapprove the goal's deadline. A conflict survives reload; it does not represent a partial or approved schedule.
- Per-day buffer use is visible and requires explicit risk acknowledgment for schedule/replan approval, even when the total sprint budget happens to fit. Unknown capacity remains unknown. A user-entered nonzero-day overload remains a visible risk that can be acknowledged; deadline/rest-day violations are hard failures.
- Date editors on planning and execution proposals stop at the corresponding goal deadline. Server-side validation remains authoritative for forged HTTP input and semantic/manual replans.
- A pre-existing explanation no longer disables saving schedule edits. Saving invalidates that explanation and any schedule approval. Goal/work approval remains intact when only availability or dates change.
- The same validators protect Agent 09 proposals, manual changes, approval and activation. Completed tasks and their recorded allocations remain immutable during replanning. Replan session instructions state the new deadline/rest-day constraints; saved remote definitions remain unchanged.

## Algorithm limits

This is a bounded deterministic heuristic, not a global optimizer. It preserves listed task order and whole task sizes. A conflict means this proposal could not fit the reviewed work under those rules, not proof that every possible ordering is infeasible. The UI gives explicit edits/retry paths. Dependencies express whole-story sequencing on separate dates, not same-day hourly sequencing. Calendar appointments and external-calendar availability are not implemented.

Legacy allocations that violate a goal deadline or use a rest day will be rejected when edited, reapproved or replanned under these rules. Existing stored user plans are not rewritten. If a legacy completed allocation violates a constraint, both completed-work preservation and the hard boundary remain enforced; reconciling its approved goal/availability requires a separately reviewed amendment rather than silently moving completed work.

## Verification

Offline regressions cover deadlines, rest days, urgent competing goals, cross-goal prerequisite deadlines, impossible windows, undersized slots, exhausted daily capacity, protected buffer, recovery, invalid approvals and immutable completed work. A deterministic 200-scenario sweep independently checks returned dates, day loads and dependency sequencing, or requires a typed conflict. It is not a statistical quality or exhaustive feasibility claim.

Live acceptance uses the existing marked synthetic QA account on NeoRishi-LifeOS-Final. Reviewed goal/work and pre-existing advice are explicitly synthetic fixtures; the later Agent 09 replan is an actual saved-resource call. The script checks conflict persistence/reload, desktop/mobile recovery, availability editing, deadline rejection without revision changes, editing after advice, approval hashes, activation, completed work, pending-only Agent 09 changes, exact approval and persistence. It also verifies that the human sprint is unchanged. See `docs/evidence/p2-scheduling-acceptance.json` and `docs/evidence/final-validation.json` for final results and IDs.

Run `npm run test:scheduling` with `LUNARSPRINTS_TEST_ORIGIN=http://127.0.0.1:3001` after starting the local build there. This invokes Agent 09 once and makes persistent changes only to a newly created marked QA sprint. Browser fallback is Playwright because the Browser plugin is unavailable. No new database migration, infrastructure, saved-agent duplication/mutation or shared authentication change is required.

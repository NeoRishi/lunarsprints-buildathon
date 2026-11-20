# LunarSprints implementation checklist

## Completed and verified

- [x] Extracted the v2 package and verified all supplied SHA-256 checksums.
- [x] Inspected the actual workspace and the user-confirmed blank Desktop application folder; no existing repository or application code was present there.
- [x] Inspected all ten saved OpenAI resources, including IDs, instructions, JSON schemas, model/reasoning configuration, tools and delegation settings.
- [x] Classified all ten as project-scoped saved Agents API resources; all initially use `gpt-6-astra`, medium reasoning, JSON Schema output, no tools and disabled delegation.
- [x] Reused existing IDs through supported official sessions; no saved-agent create/update/delete calls were made.
- [x] Pinned TypeScript, Next.js, Agents SDK, OpenAI, Supabase and validation dependencies with an npm lockfile.
- [x] Implemented the real planning API and responsive planner.
- [x] Implemented dynamic zero-to-five clarification, recommendation provenance, custom answers, skips and navigation.
- [x] Implemented SMART modification/regeneration, exact-version goal approval, story review, schedule approval and activation gates.
- [x] Implemented aggregate capacity, visible buffer, daily budgets, strict dependency validation and explicitly recorded overload acknowledgment.
- [x] Added isolated Supabase tables, RLS, atomic commit RPC, immutable revisions/audit, idempotency and database-backed rate limits.
- [x] Applied additive development migrations and registered them in Supabase migration history.
- [x] Verified a real-agent portfolio journey through persistent activation, reload, board inspection, date-change approval and reported completion.
- [x] Verified actual cross-user Data API and HTTP isolation and denied direct client access to the commit function.
- [x] Added actual recording/transcription code, consent gate, text fallback, audio signature/size checks and in-memory audio handling.
- [x] Added an execution board with day/goal filters, status/progress/DoD controls, story outcomes and approval-gated date moves.
- [x] Passed 58 offline domain/PostgreSQL/HTTP tests, including callback-origin and proxy-origin regressions; type checking and linting are included in the final validation receipt.

## Final verification

- [x] Passed the complete browser/STT check: actual MCQs, no preselection, custom overrides, saved navigation/reload, mobile width, microphone consent/denial and actual OpenAI transcription.
- [x] Passed the full persistent competing-goal scenario: two SMART goals, two goal-owned work sets, 180 minutes of effort against 96 usable minutes, blocked unacknowledged overload and recorded risk acknowledgment before activation.
- [x] Passed actual Agent 08 next-action and Agent 10 reflection controls without silent progress or schedule changes.
- [x] Final lint, typecheck, 58 tests and optimized build passed; receipt and source fingerprint are in `docs/evidence/final-validation.json`.
- [x] Final sources and evidence synchronized into the user-selected Desktop/LunarSprints folder without deleting existing files or copying secrets into the source archive.

Machine-readable evidence in `docs/evidence/` records the observed results, invocation IDs and persisted history. The exact local 127.0.0.1 callback was added to the development allowlist while preserving all existing entries and the site URL; public email delivery remains a release check.

## Existing resource reuse

| Role | Resource type | Implementation / verification |
|---|---|---|
| 01 Ask NeoRishi | Saved Agents API | Live planning introduction verified; application coordinates stages and approvals. A failed summary cannot invalidate valid saved clarification. |
| 02 Intent & Life Alignment | Saved Agents API | Live intention assessment and distinct competing intentions verified. |
| 03 SMART Goal Architect | Saved Agents API | Live readiness, dynamic questions and SMART synthesis verified; v2 schema/instructions are session overrides. |
| 04 Reality & Capacity | Saved Agents API, mapped | Deterministic code computes capacity; no model call is needed for arithmetic. |
| 05 Story & Work Decomposition | Saved Agents API | Live stories/tasks/subtasks and success-criterion coverage verified. |
| 06 Ṛta & Rhythm | Saved Agents API, mapped | Disabled; sourced opt-in adapter deferred. |
| 07 Scheduling & Focus | Saved Agents API | Live advice on code-validated scheduling verified; code computes actual dates and totals. |
| 08 Daily Execution | Saved Agents API | Actual board control and saved resource invocation passed; no progress or dates changed. |
| 09 Adaptive Backlog | Saved Agents API | Semantic replanning (`request_replan`, `edit_replan`, `reject_replan`, `approve_replan`) and user-authored date proposals implemented with deterministic before/after diff (scope, dates, dependencies, capacity) and exact-hash approval gate. |
| 10 Reflection | Saved Agents API | Actual board reflection control and saved resource invocation verified (`sess_0ca05a8bd5882706006ae19171c6088195b01658357b5b886e` in `docs/evidence/execution-guidance.json`); no progress or dates changed. |

Exact actual IDs are in `config/agent-registry.json`; successful invocation IDs are in `docs/evidence/end-to-end.json` and the other evidence JSON files.

## Engineering choices and limits

- Saved managed agents cannot be passed to SDK `agent.asTool()` as if they were local Agent instances. SDK `tool` wrappers call managed sessions through official APIs, and a TypeScript coordinator owns ordering. This preserves the requested SDK boundary without duplicating the user's fleet.
- Per-session overrides retain the saved instructions and append the v2 contract. Runtime checks reject unexpected saved-prompt/model/tool/delegation changes.
- An assessment may need answers while still returning a valid assessment/questionnaire payload. Final proposals remain separate and unapproved.
- The live API rejected the SDK-documented `spend_control` field. It is not sent. Application request limits and bounded stages exist, but a provider-enforced dollar cap is not claimed.
- Agent 03 uses a verified `gpt-6-sol` session override after the saved Astra model exceeded its timeout twice on the overcommitted multi-goal context. The same existing ID completed the comparison in 20 seconds. The override also passed all four clarification evaluations and the full multi-goal flow.
- Larger story responses use a bounded 180-second timeout; ordinary calls use 90 seconds. Failures retain the last committed draft. Both acceptance flows resumed from persisted drafts after earlier timeouts; this is recorded rather than represented as a single uninterrupted run.
- Supabase MCP was connected to a different project-access context. The initial Dev-V1 project was restored with user approval; a later user instruction selected LifeOS. Its existing schema/auth/mail configuration was inspected before the isolated migration. Current runtime and credentials point to LifeOS.
- Public Auth email delivery/redirects, privacy deletion/retention operations, provider spend controls, load tests and broader human-reviewed model evaluations remain public-release work.

## Safety of test artifacts

Only synthetic intentions, accounts and audio are used by live acceptance scripts. During earlier Dev-V1 testing, a Playwright connection error printed a synthetic QA cookie in its default failure log. QA refresh sessions were revoked, the test password was rotated, and the harness now prints redacted error summaries. Application/provider keys were not printed. Access JWTs can remain valid until expiry under Supabase semantics; the exposed account contains synthetic QA data only.

## Rollback / recovery

Stop the new local application to disable the feature; no legacy app route was replaced. Keep the additive tables and migration history for recovery. Do not drop schemas or rewrite existing migrations as a rollback shortcut. Every committed aggregate has a revision snapshot. A proposal failure leaves the prior committed state intact, and a stale write is rejected. Production deployment and destructive repository changes require separate approval.

## Current access state

OpenAI project access and existing saved resources were verified using the official API. The current backend is NeoRishi-LifeOS-Final; MCP, the authenticated official dashboard and CLI all have access to it. Its existing Google/email identities and Resend SMTP are reused. The earlier Dev-V1 connector mismatch is historical. There is no backend access blocker to the local planning/board flow. The user completes personal Google account selection. No application was deployed publicly.

## Account recovery repair, October 28, 2026

- [x] Diagnosed the reported address as an existing confirmed account; duplicate signup cannot replace its password and does not prove a confirmation email was sent.
- [x] Replaced the misleading message with privacy-preserving account guidance, and added Resend confirmation and Forgot password controls.
- [x] Allowed shorter legacy passwords for login while enforcing a ten-character minimum for newly chosen passwords.
- [x] Added authenticated password updates and PKCE recovery routing to the dedicated password form.
- [x] Verified a live synthetic password change, rejection of the old password, acceptance of the new password, safe missing-link handling and mobile rendering.
- [x] Requested a recovery email through the repaired UI; the user confirmed it arrived. The user chooses their own new password.
- [x] Added eleven authentication regression tests. Evidence: `docs/evidence/auth-fix.json`.

That account-recovery result belongs to the earlier Dev-V1 backend. The subsequent LifeOS integration reuses its existing enabled Resend SMTP provider; that configuration was preserved. No email-confirmation bypass, admin password change or production deployment was used.

## LifeOS integration, October 28, 2026

- [x] Selected the user-requested existing Pro project `NeoRishi-LifeOS-Final` (`jhkoxgyxrihsuhpjqkxc`).
- [x] Inspected 102 public tables, existing auth/profile trigger, account providers, migrations and advisor baseline.
- [x] Verified existing Google/email providers, confirmed account identity and enabled Resend SMTP.
- [x] Added the isolated `ls_*` schema with owner RLS, service-only commits and immutable audit history. Registered both source migration versions.
- [x] Preserved old tables/data, profile trigger, Google credentials, SMTP credentials/templates, site URL and existing 17 redirects. Added only the exact local app callback.
- [x] Switched both approved local environment files to existing LifeOS keys without rotating or printing any keys. OpenAI credentials/resources remain unchanged.
- [x] Verified zero real Dev-V1 drafts required transfer; retained five synthetic sprints in the old project.
- [x] Added Google sign-in with protected PKCE, exact callback and restricted redirect validation.
- [x] Passed the full real-agent planning/activation/board flow on LifeOS, including actual cross-user isolation.
- [x] Passed the full competing-goal overload approval flow, browser/voice persistence checks and active-board guidance on LifeOS.
- [x] Verified the existing Google authorization gateway and refreshed cached browser assets.
- [x] Recorded security/schema snapshots and preserved historical Dev-V1 evidence. Final release checks are recorded in `docs/evidence/final-validation.json`.

The user completes Google account selection/consent. An authorization-gateway test verifies the configured route reaches Google, and does not claim to complete that personal step. Earlier Dev-V1 email/password changes do not change a LifeOS account.

## Gemini Argon continuation, October 28, 2026

- [x] Reconciled the stale row in the resource reuse table above for Agent 10 (`reflection`) to match its verified live acceptance run recorded in `docs/evidence/execution-guidance.json` (`sess_0ca05a8bd5882706006ae19171c6088195b01658357b5b886e`).
- [x] Implemented **Agent 09 (`adaptive_backlog`) semantic replanning** (`agent_3019f5aff3784a4bb0eb2d8eaf1a9811a540bb67f94e4a07a0`) across `contracts.ts`, `policies.ts`, `domain.ts`, `coordinator.ts`, `api/sprints/route.ts`, and `ui/board.tsx`:
  - Supports AI-assisted semantic replans (`request_replan`) after missed work, blockers, or changed capacity/buffer alongside manual date proposals (`propose_replan`).
  - Deterministic validation (`validateReplanProposal`) enforces that already-completed (`done`) tasks are never deleted or regressed, goal success criteria remain covered, subtask estimates sum to task estimates, and dependency dates remain valid.
  - Deterministic diff computation (`computeReplanDiff`) exposes before/after changes across **Scope**, **Dates**, **Dependencies**, and **Capacity**.
  - Persists as a pending proposal (`pendingReplan` / `pendingSchedule`) that can be inspected, edited (`edit_replan`), rejected (`reject_replan`), or explicitly approved (`approve_replan`) with exact-hash verification and overload risk acknowledgment.
- [x] Refined planner and board UX: added client-side stop-waiting control (`AbortController`) for long-running AI calls, server validation message surfacing, overloaded calendar-day indicators, JSON sprint export (`GET /api/sprints?id=...&export=1`), and user-initiated sprint archiving (`DELETE /api/sprints?id=...`) compatible with append-only audit history.
- [x] Hardened error redaction (`redactSensitive` in `src/lib/http.ts` and `src/features/lunarsprints/agents/managed.ts`), disabled-agent runtime enforcement (`agent_disabled`), expanded clarification evaluation scenarios (`scripts/evaluate-clarification.ts`), and documented the pre-deployment public-release hardening plan in `docs/PUBLIC_RELEASE_HARDENING.md`.

## Codex verification of the Argon release, October 31, 2026

- [x] Unpacked the release without deleting local secrets or dependencies; platform configuration, all ten resource IDs/fingerprints, dependency lock and both applied migrations are unchanged.
- [x] Fixed the invalid `entry.enabled` runtime check, React effect/ref lint failures, and preserved completed task contents/story identity/allocation during replanning.
- [x] Pending proposals are invalidated by execution progress changes; previously generated next-action guidance is cleared when progress or the approved plan changes.
- [x] Exact proposal approval now includes proposal notes. Editing a proposal with unknown capacity retains that explicit unknown value.
- [x] Redacted multi-cookie headers, corrected stop-waiting language, and blocked historical command retries from returning archived sprint views.
- [x] Passed the 58-test offline suite, lint, type checking and production build. See the final validation receipt for the final source fingerprint and exact command outputs.
- [x] Actual saved Agent 09 proposal, completed-work preservation, pending-only state, forged-hash rejection, exact approval, persistence/reload, export, editor and desktop/mobile rendering passed. Its first call requested downstream specialist validation; the successful retry used a clarified session instruction, with no remote agent definition changes.
- [x] LifeOS runtime and existing Google OAuth gateway passed again. Personal Google consent remains a user action.
- [x] Synthetic export/archive acceptance passed, including origin protection and archived-view retry protection. This is archiving, not complete personal-data erasure.
- [x] Eight-case clarification acceptance: consult `docs/evidence/clarification-eval.json` and the final receipt for the actual completed result. The original Argon runner failed without saving partial results; the revised runner checkpoints each case and records safe session metadata.

No migration, database reset, remote saved-agent definition change, global Auth/SMTP/OAuth setting change or public deployment was performed during this verification.

Multi-intent clarification now restricts question intent IDs to selected IDs in the provider response schema. The verification exposed and fixed an invented `multiple` ID; an additional regression test brings the total to 58. Complex multi-intent calls have a bounded 180-second timeout. Earlier timeout/validation attempts are retained in the evidence folder.

## P0 remediation, October 31, 2026

- [x] Reproduced the fragmented-book failure with a regression that originally threw a valid clarification as an error.
- [x] Preserved null-payload clarification questions for all specialist proposal roles, with shared typed continuation handling.
- [x] Persisted question, options, answer, source, uncertainty and resume target in the owner aggregate; kept goal approval intact while awaiting input.
- [x] Required a newly reviewed goal after scope answers; blocked work generation before reapproval.
- [x] Added scope-readiness checks distinct from provisional feasibility and restricted readiness evidence to actual supplied fact IDs.
- [x] Normalized selected/custom answers into canonical planning facts; added explicit numeric availability confirmation with shared buffer arithmetic.
- [x] Added reload-safe custom/unknown responses, a proposed discovery milestone and per-question consent beyond the default five.
- [x] Preserved active work when clarifying execution guidance; unknown execution context does not request a discovery goal.
- [x] Passed full live synthetic scope-recovery journey through real work generation, schedule approval, activation and persistent board; unknown scope produced an unapproved discovery goal. Desktop/mobile checks reported no console/page errors or overflow.
- [x] Verified that the real user's sprint was unchanged by the acceptance scenarios.

Final offline, build, synchronization and final-build acceptance results are recorded in `docs/evidence/final-validation.json`; prior verification receipts remain historical. No production deployment, remote saved-agent mutation, schema migration or shared Auth/SMTP/OAuth change is part of P0. P1 performance, cost-routing, optional scheduling-advice isolation, deadline/dependency refinements and broader scenario evaluations are not claimed complete.

P0 final verification: **85 offline tests passed**, with lint, typecheck, optimized build and the actual Desktop build passing. Final live consent/discovery and Desktop smoke receipts passed. Source synchronization is verified in the final receipt. The real user sprint remains revision 7 with the original goal approval hash.


## P1: planning speed and usage measurements, October 31, 2026

- [x] Removed cosmetic Agent 01 call from initial assessment; default route is Agent 02 then Agent 03.
- [x] Schedule generation is deterministic with zero AI calls; saved Agent 07 explanation is optional, cannot block approval, and is reused while the schedule hash matches.
- [x] Canonical confirmed facts replace duplicated questionnaire/options/answer IDs in planning context.
- [x] Compact per-session v2.1 response frame preserves clarification, warnings, goal assumptions/readiness, recommendation provenance and all domain/approval checks.
- [x] Benchmarked the same saved Agent 05 on two workloads with full/Astra vs compact/6.1 Sol. Both profiles passed deterministic hierarchy, criterion coverage, estimate and dependency checks. Enabled 6.1 Sol for Agent 05 sessions only; saved definitions and registry fingerprints remain unchanged.
- [x] Added one aggregate metrics JSON column to `ls_agent_runs` only. Existing RLS remains in force. Provider usage reconciliation and inserts occur after the HTTP response; null means unavailable, never zero cost.
- [x] Final quality: 95 offline tests, lint, typecheck, optimized build and actual Desktop build pass. Live planning, optional advice, zero-model scheduling, P0 recovery and desktop/mobile smoke pass. Source synchronization and secret scan are verified in `docs/evidence/final-validation.json`.

See `docs/P1_PLANNING_PERFORMANCE.md` for measurements, test commands, safe rollback and remaining work. This phase does not introduce durable background planning jobs, client-visible streaming or a public-launch certification.


## P2: scheduling and planning reliability, October 31, 2026

- [x] Enforced goal-specific deadlines and zero-minute rest days on manual/semantic proposals, schedule approval, replan approval and activation.
- [x] Propagated successor deadlines to prerequisites and scheduled urgent competing goals first, while retaining reviewed within-story task order and separate-date dependencies.
- [x] Replaced silent overload placement with an actionable persisted scheduling conflict and an availability/work-edit recovery UI; preserved reviewed work, approvals and existing allocations.
- [x] Exposed daily protected-buffer use and required explicit risk acknowledgment; no risk acknowledgment bypasses deadline/rest-day boundaries.
- [x] Fixed saving edited schedules after optional advice; saving invalidates the stale explanation.
- [x] Added 18 focused regressions including a deterministic sweep over 200 varied deadline/dependency/availability scenarios.
- [x] Final verification: 113 offline tests, lint, typecheck, optimized build and actual Desktop build pass. Live conflict recovery, schedule editing, deadline rejection, exact approvals and saved Agent 09 replan pass. Desktop/source synchronization and secret scan are verified in the final receipt.

No new database migration, remote saved-agent change, shared Auth/OAuth/SMTP change, infrastructure or public deployment is part of P2. Source details and algorithm limits are in `docs/P2_SCHEDULING_RELIABILITY.md`.

# Historical development notes

> Historical. Step 1 of the buildathon migration removed the AI provider, saved agents, voice transcription and hosting setup described below. AI actions now return a plain "being upgraded" message until the new agent service is connected. Step 2A then replaced the hosted database and sign-in described below with PostgreSQL and Firebase Authentication. The current and target stack are in [`GEMINI.md`](../GEMINI.md).

These cumulative notes describe development history. Historical QA screenshots, raw synthetic model outputs and acceptance receipts remain in the preserved local P2 release; they are not published in this repository. The root README and website guide describe this GitHub delivery. The latest P2 baseline had 113 offline tests. Relative links below retain their original context.

# LunarSprints

A working development application that turns an intention into an explicitly approved, persistent 15-day sprint. Built from the supplied v2 handoff, with the prototype used as an interaction reference.

The application is installed in `/Users/neorishi/Desktop/LunarSprints`. This source deliverable is a matching copy. No Git repository was created, no legacy repository was overwritten, and no production deployment was made.

## Run

```sh
cd /Users/neorishi/Desktop/LunarSprints
npm run dev
```

Open [LunarSprints locally](http://127.0.0.1:3000). Only one server should use port 3000. The ignored `.env.local` has been configured through the approved credential flows. Credentials are excluded from source archives.

The app supports Supabase email/password sign-in and signup. The exact development callback `http://127.0.0.1:3000/auth/callback` was added and verified with Supabase. All 17 existing LifeOS redirect entries and the `https://www.neorishi.io` site URL were preserved. Use the 127.0.0.1 URL above: another local app currently occupies localhost over IPv6. Signup confirmation uses a PKCE callback at `/auth/callback`; email delivery and the project's allowed redirect URLs must be verified for the final public domain before release. Live acceptance tests use explicitly marked, email-confirmed synthetic QA accounts rather than sending email to real people.

## Confirmation and password recovery

The sign-in panel has Resend confirmation and Forgot password controls. Existing confirmed accounts should sign in with their existing password; signing up again does not replace that password or necessarily send another email. Signup responses preserve account privacy and do not claim delivery from an absent session. Existing shorter passwords remain valid for login; new passwords require at least ten characters.

Recovery requests use the exact allowlisted callback, save the PKCE verifier in an HttpOnly cookie, and route recovery callbacks to `/account/reset-password`. Open the newest link in the same browser where it was requested. The password update API verifies the session and updates only that user's password. Provider restrictions, outages and sending limits have actionable responses. A synthetic live test verifies old-password rejection and new-password acceptance.

The application reuses LifeOS's enabled Resend SMTP provider (`smtp.resend.com`) without changing its credentials, sender, templates or confirmation policy. Google sign-in uses the existing LifeOS OAuth client and the exact app callback. LifeOS accounts and passwords are separate from the earlier Dev-V1 project; the earlier Dev-V1 reset email applies only to that project. Use Continue with Google or your existing LifeOS email/password.

The migration inspected 102 existing public tables and found no `ls_*` collisions. Its two additive source migrations are registered in LifeOS migration history. There were no real Dev-V1 sprint drafts to transfer; the five synthetic QA sprints remain untouched. Historical verification is preserved in `docs/evidence/history-dev-v1/`. See `docs/LIFEOS_INTEGRATION.md` for the integration record and remaining checks.

## Working journey

1. Choose 15 inclusive calendar days, timezone, available time, daily budgets and an explicit buffer.
2. Type an intention. (Voice input was turned off in Step 1 and returns in a later step.)
3. Assess distinct intentions and explicitly select which goals belong in the sprint.
4. Generate zero to five context-specific clarification questions through existing Agent 03. Recommendations have reasons and provenance; they are never preselected. Custom text overrides a radio answer. Question navigation saves answers; reload reads them from Supabase.
5. Generate editable SMART goals from confirmed facts. Review assumptions and success criteria, then explicitly approve the exact goal version.
6. Generate and review stories, tasks, subtasks and observable Definitions of Done. Edit content, effort, coverage, priorities and dependencies; explicitly approve the work set.
7. Review a deterministic date-and-effort schedule and optional Agent 07 advice. Edit dates, allocations and availability. See combined capacity across all goals; an override requires an explicit recorded acknowledgment.
8. Approve the schedule, then separately confirm activation.
9. Use the active board: day/goal filters, five status columns, story outcomes, task inspection, subtask checks, progress notes, actual time reports and versioned date-change proposals. Completion requires an explicit user report and completion checks.

No production AI path uses canned questions, sample research stories, simulated voice, fake completion, or localStorage as the application database. Routine interface instructions are ordinary product copy. Test doubles and the short synthetic spoken-audio fixture are confined to tests.

## Existing agents

At the time, ten saved agents hosted by the previous AI provider handled the AI roles. Their registry, client code and SDK packages were removed in Step 1. The role summaries remain in `src/features/lunarsprints/agents/prompts/`.

The topology was an application-owned TypeScript coordinator that called each saved agent through a bounded wrapper, with no model database-write tools and no autonomous delegation. Two roles (goal clarification and work breakdown) used per-session model overrides that were benchmarked for speed. The provider-specific details were removed with the code in Step 1; git history keeps them.

Planning calls Agents 02, 03 and 05. Application copy replaces the former cosmetic Agent 01 call; its saved resource remains intact. Scheduling uses deterministic code; the user can optionally request an explanation from saved Agent 07. Agent 04's arithmetic is implemented by deterministic capacity services. Agent 08 next-action and Agent 10 reflection controls were wired to their saved resources. Agent 09 provides semantic replan proposals under deterministic validation and explicit approval. Agent 06's opt-in sourced rhythm guidance remains later-phase work. See the verified-use table in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Persistence and security

Supabase project: `jhkoxgyxrihsuhpjqkxc` (`NeoRishi-LifeOS-Final`), in the existing Pro organization. The local app now uses its existing users, Google provider, email authentication and Resend SMTP configuration. Existing legacy tables remain unchanged. The isolated `ls_*` tables reference the same `auth.users` identities; no second profile or identity system was created.

- `ls_sprints`: owner-scoped aggregate containing intention history, questionnaire, answers, multiple goals, stories/tasks, schedule, approvals and execution state.
- `ls_revisions`: immutable complete snapshots, one per committed revision.
- `ls_commands`: request hashes and idempotent results.
- `ls_events`: append-only user action and approval hashes.
- `ls_agent_runs`: role/resource/session/turn IDs, latency/status, effective model, token/cache/reasoning counts and first-output latency; no raw prompts or credentials. Missing provider usage remains null. A bounded metadata lookup and telemetry insert run after the HTTP response.
- `ls_rate_limits`: database-backed request counters.

Authenticated clients can read only their own permitted rows. They cannot write aggregates, forge approvals through the Data API, invoke the commit RPC, or edit audit history. API commands verify the Supabase user, derive ownership on the server, validate schemas/domain invariants, check proposal hashes and optimistic revisions, and commit state/history/events/idempotency atomically. Session cookies are HttpOnly, SameSite Lax and Secure in production. Request bodies are bounded even without Content-Length. Cross-origin writes are rejected against the actual request host or configured `APP_ORIGIN`.

LifeOS's existing security-advisor baseline is recorded in `docs/evidence/lifeos-security-baseline.json`: it includes existing function-execution warnings and RLS-without-policy information for unrelated tables. Existing application permissions were preserved. Provider/project dollar caps, public-domain release verification, privacy/retention operations and broader abuse/load testing remain public-launch gates. Do not run a whole-project `supabase db push` from this feature-only migration folder; LifeOS has existing migration history owned by its other applications.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

All 85 offline tests passed. Offline tests include a real embedded PostgreSQL engine for migrations, RLS, service permissions, transactional revisions, stale updates, idempotency and rate counters. PGlite is a development-test dependency; the application uses Supabase.

Live checks require the explicitly authorized LifeOS project and a running local server. Checks that ask for AI suggestions fail until the new agent service is connected:

```sh
npm run test:e2e        # Real planning, authenticated persistence and board checks
npm run test:multi      # Two competing goals and explicit overload approval
npm run test:execution  # Real Agent 08/10 board controls; no silent state changes
npm run test:auth       # Duplicate signup, existing login and live password updates
npm run test:platform   # LifeOS connection, existing Google gateway and mobile sign-in
npm run test:replan     # Saved Agent 09, pending diff, approval and persistent replan
npm run test:recovery   # P0: missing scope → saved question → reapproval → persistent board; unknown → discovery
npx tsx --env-file=.env.local scripts/archive-check.ts # Synthetic export/archive checks
```

Live checks create clearly marked synthetic QA accounts/data in the user-authorized LifeOS project. They must use its existing strong-password policy. They do not send invitations or confirmation email to real users. Their credentials stay in ignored `.env.test.local`. Evidence in [`docs/evidence/`](docs/evidence/) includes actual resource/session IDs, saved revisions, test results and browser screenshots. Live model outputs can vary; passing fixtures are acceptance evidence, not a broad statistical quality guarantee. Historical Dev-V1 evidence records resumptions after provider timeouts. Current LifeOS evidence records new verification runs and their persisted revisions.

## Deliberately deferred

Full duplex realtime voice, optional verified Panchānga/Jyotiṣa, birth data, retrieval ingestion, long-term preference memory, calendar bookings, automatic carryover, historical burndown analytics are not represented as completed features. Interfaces/disabled flags exist for future rhythm and knowledge adapters. Current “effort remaining” is estimated effort weighted by user-reported progress, not claimed actual work.

The product still needs public-launch operational review and broader evaluation; this is a functional, verified development release, not a claim of a deployed production service.

## Official integration references

- [Supabase server-side authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

Agent 09 semantic replanning is implemented and live verified; review `docs/evidence/replan-acceptance.json`. Its candidates remain pending until exact-version approval. Completed task definitions and allocations are preserved; new progress invalidates older pending proposals. Archiving hides a sprint through the app but retains historical content. Stop waiting disconnects the client; refresh the saved plan to reconcile any server commit. See `docs/PUBLIC_RELEASE_HARDENING.md` for remaining release gates.

## P0 clarification recovery

A specialist's `needs_clarification` response is now a saved planning step. It preserves the approved goal, the actual question/options, prior answers and the command to resume. Reloads retain the question and a saved answer. Unchanged generation retries are rejected while a question awaits an answer. Extra questions beyond five require explicit per-question continuation consent.

Agent 03 checks scope readiness separately from feasibility. New goal proposals include a bounded scope assessment; legacy or manually edited approved goals are checked before decomposition. A scope answer goes through a revised goal proposal and explicit approval before stories. “I don’t know yet” on a scope question requests an explicitly unapproved, bounded discovery milestone; the original outcome is retained. Unknown context on an active guidance request does not request a discovery goal or mutate work.

Confirmed answers are normalized with their selected/custom wording, provenance and certainty. Approximate time answers do not silently become validated numeric availability. The planner offers an explicit editable time-budget confirmation, sharing the confirmed total and buffer with later stages. No migration, agent definition change, authentication change or additional infrastructure is required.

`docs/evidence/clarification-recovery.json` records the full live synthetic legacy-book journey and unknown-scope proposal. `p0-final-discovery.json` records the final discovery/consent path. Fixtures are explicitly synthetic; seeded legacy approvals are not represented as newly AI-generated goals. The real user's stalled sprint is not modified by acceptance tests. P1 cost/latency optimization and broader release hardening remain separate work.

P1 performance changes, measured results and remaining limits: [`docs/P1_PLANNING_PERFORMANCE.md`](docs/P1_PLANNING_PERFORMANCE.md). Run `npm run test:performance` for the marked QA acceptance journey (it uses real AI calls, so it fails until the new agent service is connected).

P2 scheduling now enforces each goal deadline and zero-minute rest days, propagates prerequisite deadlines, saves actionable conflicts without partial allocations, and exposes daily buffer use for approval. Schedule edits remain available after optional advice. See [`docs/P2_SCHEDULING_RELIABILITY.md`](docs/P2_SCHEDULING_RELIABILITY.md) for the bounded heuristic, migration-free implementation, regression scenarios and live acceptance.

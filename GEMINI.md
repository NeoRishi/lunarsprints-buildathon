# LunarSprints (NeoRishi Sprints): project rules

Antigravity reads this file at the start of every session. Machine-readable facts are in `project-context.json`. Next.js 16 notes are in `AGENTS.md`. Reusable review and writing rules are skills in `.agents/skills/`.

## What the product is

LunarSprints is a Daily Clarity Engine. It answers one question: "Given my goals, deadlines, capacity and commitments, what deserves my attention today?"

* Core promise: "Know what matters today." Key surfaces: MUST MOVE, WHY THIS?, NOT TODAY. (These surfaces are not built yet as of November 2026.)
* It is NOT an astrology app, horoscope app, to-do manager, project-management tool, chatbot or habit-streak app.
* The lunar layer is secondary. The product must stay useful with all lunar features turned off. User reality always overrides lunar context.
* First audience: founders and independent professionals, India first, available worldwide.

## Where things live today

| Item | Value |
|---|---|
| GitHub repo | NeoRishi/lunarsprints-buildathon (default branch `master`) |
| Local folder | ~/Downloads/LunarSprints-buildathon |
| Original product repo | NeoRishi/lunar-sprints (this copy branched from it at commit e69e8dc) |
| Production URL | https://sprints.neorishi.io (app at `/app`, landing page at `/`). The buildathon build is not deployed yet. |
| Sign-in | Firebase Authentication, project `lunarsprints-62d7d`. Locally it runs on the Auth emulator (no cost). Account emails (confirmation, sign-in links, password reset) are sent by Firebase. |
| Database | Local PostgreSQL 16 for now (`lunarsprints_dev`, `lunarsprints_test`). Cloud SQL for PostgreSQL arrives in Step 2B. LunarSprints tables use the `ls_` prefix. |
| Hosting | Cloud Run in Step 2B. Nothing runs on Google Cloud yet and no billing is turned on. |
| DNS | Hostinger, for neorishi.io |
| AI | Not connected during the migration. See "Migration status". |

## Stack (current code)

Next.js App Router (v16, see `AGENTS.md`), TypeScript, plain CSS with Moonlit design tokens in `src/app/globals.css` plus CSS modules (no Tailwind), Firebase Authentication (`firebase` in the browser, `firebase-admin` on the server), PostgreSQL through `pg`, Zod, Vitest, Playwright, npm, Node 22 to 24. `next.config.ts` builds a standalone server (`output: "standalone"`) for Cloud Run.

* Sign-in: the browser signs in with Firebase, then `POST /api/auth/session` checks the ID token and sets a five-day httpOnly `__session` cookie. Every signed-in route calls `authenticated()` in `src/lib/session.ts`. Accounts with an unconfirmed email never get a session.
* Database: `src/lib/db.ts` holds one pool built from `DATABASE_URL`, connected as `ls_app`. Every user query runs inside `withUser(userId, fn)`, which sets `app.user_id` for Row Level Security. Migrations live in `db/migrations/` and run with `npm run db:migrate` as `ls_owner`.

Environment variables (names only, never print values): `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_USE_AUTH_EMULATOR`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_EMULATOR_HOST`, `DATABASE_URL`, `DATABASE_URL_OWNER`, `DATABASE_URL_TEST`, `APP_ORIGIN=https://sprints.neorishi.io`, `DEPLOYMENT_VERSION`. In production the app's public address comes only from `APP_ORIGIN`.

## Target stack (buildathon)

* **Web app:** this Next.js app, packaged as a container and run on Cloud Run.
* **Agent service:** a separate Python service built with the Agent Development Kit (ADK), running on Cloud Run and using Gemini models. The web app calls it through the `Intelligence` interface.
* **Voice:** Gemini Live API.
* **Sign-in:** Firebase Auth.
* **Database:** Cloud SQL for PostgreSQL.
* **Analytics:** BigQuery, plus a data agent that answers questions over it.
* **Reminders:** Firebase Cloud Messaging.
* **Operations:** Secret Manager for secrets, Cloud Build and Artifact Registry for builds and images, Cloud Logging and Cloud Trace for monitoring.

## Migration status

* **Step 1 (clean slate): done.** All previous AI vendor code, the old hosting config and voice transcription are removed. AI actions return the plain message "AI suggestions are being upgraded. Your saved plan is safe." (code `ai_not_connected`, status 503). Every flow that does not need AI still works.
* **Step 2A (local foundation): done.** Sign-in moved to Firebase Authentication (email and password with required email confirmation, and email sign-in links). The database moved to plain PostgreSQL with Row Level Security forced on every `ls_` table, running locally on this Mac with the Auth emulator, at no cost.
* **Step 2B (next):** Cloud SQL, Cloud Run, Secret Manager and real Firebase sign-in emails. Not started.
* Steps 3 to 7 are not started. Do only the step you are asked to do.

## How AI fits in

* All AI calls go through the `Intelligence` interface in `src/features/lunarsprints/agents/intelligence.ts`. The coordinator and tests depend only on that interface.
* `UnavailableIntelligence` in the same file is the temporary engine. It is the only engine wired in today (`src/app/api/sprints/route.ts`).
* Kept for the new agent service: output schemas and validation in `agents/contract.ts`, instruction text in `agents/policies.ts`, clarification handling in `agents/outcomes.ts`, and role summaries in `agents/prompts/`. The prompt files are short summaries, not full instructions.
* Roles used by the app: smart_goal, intent_alignment, story_decomposer, scheduling, adaptive_backlog, daily_execution, reflection. `orchestrator` and `capacity` are never invoked; `rhythm` is disabled.
* `src/lib/audio.ts` keeps the recording header check for the voice feature that returns later.

## Product decisions already taken

* Sprint length: 3 to 45 days overall. Recommended preset: paksha sprints (Pratipada to Purnima or Amavasya). Custom start and end dates allowed. One account can have many sprints over time.
* Free tier: 1 active sprint of 3 to 15 days. LunarSprints+ (coming soon): up to 3 active sprints of up to 45 days. Limits live in `config/plans.json`, not in code, and the landing page reads them from there.
* Payments: on hold. Pricing page shows LunarSprints+ (Rs 299/month) as "coming soon". Do not build payments unless asked.
* Login: open signup with email and password or an email sign-in link. Google sign-in comes later. Shared NeoRishi LifeOS login is not part of the buildathon build.
* Reminders: email only today. Firebase Cloud Messaging is the target.
* Visual direction: "Moonlit": dark night background, moonlight text, one soft gold accent, thin serif headlines, minimal.
* On-screen language is plain: no "SMART", "Definition of Done", agent names or "semantic replan". Use "Done means", "milestones", "steps", "Adjust the plan".
* Legal pages (Privacy, Terms, Refunds, Contact) exist. Company: NeoRishi Wellness (OPC) Private Limited, Pune 411014.

## Invariants (never break these)

1. Deterministic core: planning and ranking must work with no LLM call. AI assists, it does not decide silently.
2. Never silently rebuild today's plan. Plan revisions are immutable.
3. Reality before lunar context. Never show fake lunar data in production.
4. Preserve Row Level Security. RLS stays enabled and forced on every `ls_` table. The app connects as `ls_app` (not the owner, no superuser, no BYPASSRLS) and every user query goes through `withUser`. No owner or admin shortcuts in user paths.
5. Server decides identity and dates. Never trust browser-supplied origin or user ID.
6. Database migrations are additive only: add a new file in `db/migrations/`, never edit or delete one that has run. Touch only LunarSprints (`ls_`) tables.
7. No secrets in code, chat, logs or commits.
8. No silent fallbacks. If an AI feature is unavailable, the user sees an honest, plain message and their saved plan stays safe.

## Quality guides

* `.agents/skills/ui-quality/SKILL.md`: visual rules for Moonlit screens (tokens only, one accent, no template tells).
* `.agents/skills/copy-quality/SKILL.md`: plain-language glossary, banned words, honest claims.
* `.agents/skills/silent-failure-hunter/SKILL.md` and `.agents/skills/refactor-cleaner/SKILL.md`: read-only reviewers that report findings and never edit code.
* `tests/copy-guard.test.ts` runs in `npm test`. It fails on new em-dashes and on-screen jargon. Existing problems are listed in `tests/copy-guard-baseline.json`, which may only shrink.
* Attribution for adapted material: `docs/THIRD_PARTY_NOTICES.md`.

## Working rules

* Work on a branch, open a PR, and stop. The owner reviews and merges.
* Git: no reset, force push, branch deletion, history rewrite or squashing finished work. If ancestry looks wrong, stop and report.
* Commit identity must be `NeoRishi <hrishikesh.wattamwar@gmail.com>` (with the dot). Never override it.
* Before every PR: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build` all pass.
* Ask before anything hard to undo: database changes on the live project, DNS, cloud project settings, deleting files.
* Stop at the requested phase and report. Don't drift into the next one.

## How the owner wants you to communicate

* Plain language first. Explain decisions simply; technical labels second.
* Ask clarifying questions (multiple choice with a recommended answer) before big work.
* Never use em-dashes in any output, including code comments, docs, UI copy and PR text.
* Flag invented testimonials, fake social proof or unverifiable claims by name and propose honest replacements.
* Call out scope creep and perfectionism-restart cycles when you see them.

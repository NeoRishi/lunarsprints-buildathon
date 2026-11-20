# LunarSprints

Turn a vague intention into a realistic, approved and executable sprint of 3 to 45 days.

This repository contains the Next.js application: dynamic goal clarification, editable goals and work breakdown, deterministic scheduling, approval gates, persistent sprint data, an execution board and explicit adaptive replanning.

## Buildathon migration

This copy is moving to a Google Cloud stack in seven steps. Project rules, the target stack and the current migration status are in [`GEMINI.md`](GEMINI.md).

Step 1 is done: the previous AI vendor code, hosting config and voice transcription are removed. AI actions show "AI suggestions are being upgraded. Your saved plan is safe." Everything that does not need AI (viewing sprints, today's plan, editing milestones and schedules, approvals and progress) still works.

Step 2A is done: sign-in uses Firebase Authentication and the data lives in PostgreSQL with Row Level Security. Everything runs on your Mac at no cost. Cloud SQL and Cloud Run come in Step 2B.

## Run locally

You need Node 22 to 24, PostgreSQL 16 and Java 21 (for the Firebase emulator tools). On a Mac with Homebrew:

```sh
brew install postgresql@16 openjdk@21
brew services start postgresql@16
```

1. **Install.** `npm ci`
2. **Settings.** Copy `.env.example` to `.env.local` and fill it in privately. Never paste values into chat or commit them. For local work:
   * `DATABASE_URL`: `postgres://ls_app:<a password you choose>@localhost:5432/lunarsprints_dev`
   * `DATABASE_URL_OWNER`: `postgres://ls_owner:<another password>@localhost:5432/lunarsprints_dev`
   * `DATABASE_URL_TEST`: same as `DATABASE_URL` but ending in `lunarsprints_test`
   * `NEXT_PUBLIC_USE_AUTH_EMULATOR=true`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIREBASE_PROJECT_ID` and `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `lunarsprints-62d7d`, `APP_ORIGIN=http://127.0.0.1:3000`
   * The other `NEXT_PUBLIC_FIREBASE_*` values come from the Firebase console (Project settings, Your apps, Web app config). With the emulator any non-empty value works.
3. **Create the database roles and databases (once).** `npm run db:setup`
4. **Migrate.** `npm run db:migrate` (and `npm run db:migrate:test` for the test database). Safe to run again.
5. **Run.** `npm run dev:local` starts the Auth emulator, its UI at http://127.0.0.1:4000 and the app at http://127.0.0.1:3000/app. Confirmation and sign-in emails are not sent: their links appear in the terminal and in the emulator UI.

`npm run emulators` starts only the emulator, if you want to run `npm run dev` separately.

## Verify

```sh
npm run lint
npm run typecheck
npm test            # fast unit tests, no services needed
npm run test:rls    # Row Level Security on the local lunarsprints_test database
npm run test:auth   # sign-in flows on the Firebase Auth emulator (starts it for you)
npm run build
```

`test:rls` fails, never skips, when `DATABASE_URL_TEST` is missing.

## Deployment

`next.config.ts` builds a standalone server for a Cloud Run container. The container, build and deployment setup arrive in Step 2B. A production server refuses to start sign-in if `FIREBASE_AUTH_EMULATOR_HOST` is set. Production reads its public address only from `APP_ORIGIN`. Server secrets belong in Secret Manager, never in GitHub files.

## Architecture and guardrails

- TypeScript, Next.js, React, Firebase Authentication and PostgreSQL today. Target: Cloud Run, a Python ADK agent service using Gemini, and Cloud SQL (see `GEMINI.md`).
- Row Level Security is forced on every `ls_` table. The app connects as `ls_app` and runs every user query through `withUser` in `src/lib/db.ts`. Migrations in `db/migrations/` are additive only.
- All AI calls go through the `Intelligence` interface in `src/features/lunarsprints/agents/intelligence.ts`. Models propose content; the application owns validation, capacity, dates, persistence and explicit approvals.
- Payments, real lunar data and durable background generation are proposed next-phase work, not current integrations.

Read the [architecture and next-version blueprint](docs/architecture/LunarSprints_Architecture_and_Next_Version.md) (to be redrawn for the new stack), [P2 scheduling notes](docs/P2_SCHEDULING_RELIABILITY.md), [public release hardening](docs/PUBLIC_RELEASE_HARDENING.md) and [historical development notes](docs/DEVELOPMENT_BASELINE.md).

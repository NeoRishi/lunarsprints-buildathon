# LunarSprints

Turn a vague intention into a realistic, approved and executable sprint of 3 to 45 days.

This repository contains the Next.js application: dynamic goal clarification, editable goals and work breakdown, deterministic scheduling, approval gates, persistent sprint data, an execution board and explicit adaptive replanning.

## Buildathon migration

This copy is moving to a Google Cloud stack in seven steps. Project rules, the target stack and the current migration status are in [`GEMINI.md`](GEMINI.md).

Step 1 is done: the previous AI vendor code, hosting config and voice transcription are removed. AI actions show "AI suggestions are being upgraded. Your saved plan is safe." Everything that does not need AI (viewing sprints, today's plan, editing milestones and schedules, approvals and progress) still works.

Step 2A is done: sign-in uses Firebase Authentication and the data lives in PostgreSQL with Row Level Security. Everything runs on your Mac at no cost. Cloud SQL and Cloud Run come in Step 2B.

Step 3, Run 1 is done: a separate Python agent service (`agents-service/`, Google ADK on Gemini) suggests the intention summary, follow-up questions, goals, milestones and steps, and schedule notes. The app checks every suggestion before saving and the person approves it. Daily focus, plan adjustments and reflection still show "AI suggestions are being upgraded. Your saved plan is safe." until Run 2. See [docs/architecture/agents.md](docs/architecture/agents.md).

## Run locally

You need Node 22 to 24, PostgreSQL 16, Java 21 (for the Firebase emulator tools), and uv with Python 3.12 or newer (for the agent service). On a Mac with Homebrew:

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
   * AI suggestions: `GOOGLE_API_KEY` (a Google AI Studio key), `GOOGLE_GENAI_USE_VERTEXAI=false`, `GEMINI_MODEL_DEFAULT` (and optionally `GEMINI_MODEL_<ROLE>` per role), `AGENTS_SERVICE_URL=http://127.0.0.1:8080` and `AGENTS_SERVICE_TOKEN` (any long random string, for example from `openssl rand -hex 32`). Leave `AGENTS_SERVICE_URL` empty to run without AI.
3. **Create the database roles and databases (once).** `npm run db:setup`
4. **Migrate.** `npm run db:migrate` (and `npm run db:migrate:test` for the test database). Safe to run again.
5. **Install the agent service (once).** `cd agents-service && uv sync && cd ..`
6. **Run.** `npm run dev:all` starts the Auth emulator (UI at http://127.0.0.1:4000), the agent service at http://127.0.0.1:8080 and the app at http://127.0.0.1:3000/app. Ctrl+C stops all three. Confirmation and sign-in emails are not sent: their links appear in the terminal and in the emulator UI.

`npm run dev:local` runs the emulator and the app without the agent service. `npm run emulators` starts only the emulator, and `npm run agents:dev` only the agent service.

## Verify

```sh
npm run lint
npm run typecheck
npm test            # fast unit tests, no services needed
npm run test:rls    # Row Level Security on the local lunarsprints_test database
npm run test:auth   # sign-in flows on the Firebase Auth emulator (starts it for you)
npm run build
npm run agents:check  # agent service: ruff, mypy and pytest (the model is faked)
```

Live checks that use the Gemini key (not run in CI):

```sh
npm run eval:agents       # eval cases per role, prints the pass rate and every failed case
npm run test:ai-planning  # with npm run dev:all running: sign up, plan with AI, approve, reload
```

After changing a schema in `src/features/lunarsprints/agents/contract.ts`, run `npm run contracts:build` and commit `contracts/schemas/`.

`test:rls` fails, never skips, when `DATABASE_URL_TEST` is missing.

## Deployment

`next.config.ts` builds a standalone server for a Cloud Run container. The container, build and deployment setup arrive in Step 2B. A production server refuses to start sign-in if `FIREBASE_AUTH_EMULATOR_HOST` is set. Production reads its public address only from `APP_ORIGIN`. Server secrets belong in Secret Manager, never in GitHub files.

## Architecture and guardrails

- TypeScript, Next.js, React, Firebase Authentication and PostgreSQL, plus a Python ADK agent service on Gemini. Target: Cloud Run and Cloud SQL (see `GEMINI.md`).
- Row Level Security is forced on every `ls_` table. The app connects as `ls_app` and runs every user query through `withUser` in `src/lib/db.ts`. Migrations in `db/migrations/` are additive only.
- All AI calls go through the `Intelligence` interface in `src/features/lunarsprints/agents/intelligence.ts`. Models propose content; the application owns validation, capacity, dates, persistence and explicit approvals.
- Payments, real lunar data and durable background generation are proposed next-phase work, not current integrations.

Read the [architecture and next-version blueprint](docs/architecture/LunarSprints_Architecture_and_Next_Version.md) (to be redrawn for the new stack), [P2 scheduling notes](docs/P2_SCHEDULING_RELIABILITY.md), [public release hardening](docs/PUBLIC_RELEASE_HARDENING.md) and [historical development notes](docs/DEVELOPMENT_BASELINE.md).

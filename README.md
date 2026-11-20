# LunarSprints

Turn a vague intention into a realistic, approved and executable sprint of 3 to 45 days.

This repository contains the Next.js application: dynamic goal clarification, editable goals and work breakdown, deterministic scheduling, approval gates, persistent sprint data, an execution board and explicit adaptive replanning.

## Buildathon migration

This copy is moving to a Google Cloud stack in seven steps. Project rules, the target stack and the current migration status are in [`GEMINI.md`](GEMINI.md).

Step 1 is done: the previous AI vendor code, hosting config and voice transcription are removed. AI actions show "AI suggestions are being upgraded. Your saved plan is safe." Everything that does not need AI (viewing sprints, today's plan, editing milestones and schedules, approvals and progress) still works. Supabase remains the database and sign-in until Step 2.

## Run locally

Use Node 22 to 24. Copy `.env.example` to `.env.local` and fill in the values privately. Use the existing approved Supabase project; never put secrets into source control or chat.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Live scripts in `scripts/` are separate: inspect their account and project guards before running them, because they write synthetic data to the shared database. Scripts that ask for AI suggestions fail until the new agent service is connected.

## Deployment

`next.config.ts` builds a standalone server for a Cloud Run container. The container, build and deployment setup arrive in Step 2. Production reads its public address only from `APP_ORIGIN`. Server secrets belong in Secret Manager, never in GitHub files.

## Architecture and guardrails

- TypeScript, Next.js, React and Supabase today. Target: Cloud Run, a Python ADK agent service using Gemini, Firebase Auth and Cloud SQL (see `GEMINI.md`).
- Shared backend: `NeoRishi-LifeOS-Final` (`jhkoxgyxrihsuhpjqkxc`). No whole-project database push or reset; preserve unrelated tables, Auth triggers, Google credentials, Resend SMTP and existing redirects.
- All AI calls go through the `Intelligence` interface in `src/features/lunarsprints/agents/intelligence.ts`. Models propose content; the application owns validation, capacity, dates, persistence and explicit approvals.
- Payments, real lunar data and durable background generation are proposed next-phase work, not current integrations.

Read the [architecture and next-version blueprint](docs/architecture/LunarSprints_Architecture_and_Next_Version.md) (to be redrawn for the new stack), [P2 scheduling notes](docs/P2_SCHEDULING_RELIABILITY.md), [public release hardening](docs/PUBLIC_RELEASE_HARDENING.md) and [historical development notes](docs/DEVELOPMENT_BASELINE.md).

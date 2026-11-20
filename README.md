# LunarSprints

Turn a vague text or spoken intention into a realistic, approved and executable sprint of 3 to 45 days.

This repository contains the verified P2 Next.js application: dynamic goal clarification, editable goals and work breakdown, deterministic scheduling, approval gates, persistent sprint data, an execution board and explicit adaptive replanning.

## Run locally

Use Node 22–24. Copy `.env.example` to `.env.local` and configure credentials privately. Use the existing approved Supabase/OpenAI projects; never put secrets into source control or chat.

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

The preserved P2 baseline had 113 offline tests across 8 files. Live scripts are separate: inspect their account/project guards before running them, because they incur provider cost and write synthetic cloud data.

## Run as a website

Deploy this full-stack Next.js app on Vercel or a compatible Node host. GitHub stores the source; GitHub Pages cannot execute its authenticated APIs, server-side AI calls or database writes. See [Website deployment](docs/WEBSITE_DEPLOYMENT.md) for configuration and acceptance checks.

Use a separate `lunar-sprints` hosting project. Existing older LunarSprints deployments must not be overwritten implicitly. Server secrets belong in the hosting provider's environment settings, never in GitHub files.

## Architecture and guardrails

- TypeScript, Next.js, React, OpenAI Agents SDK/API and Supabase.
- Shared backend: `NeoRishi-LifeOS-Final` (`jhkoxgyxrihsuhpjqkxc`). No whole-project database push/reset; preserve unrelated tables, Auth triggers, Google credentials, Resend SMTP and existing redirects.
- OpenAI project `lunarsprints` (`proj_vI5AtNhbZISblXntDQZHNhZ1`): reuse the exact ten saved IDs in `config/agent-registry.json`; do not duplicate or mutate remote agents.
- The application owns deterministic validation, capacity, dates, persistence and explicit approvals. Models propose content.
- Payments, real lunar data and durable background generation are proposed next-phase work, not current integrations.

Read the [architecture and next-version blueprint](docs/architecture/LunarSprints_Architecture_and_Next_Version.md), [P2 scheduling notes](docs/P2_SCHEDULING_RELIABILITY.md), [public release hardening](docs/PUBLIC_RELEASE_HARDENING.md) and [historical development notes](docs/DEVELOPMENT_BASELINE.md).

The original Desktop P2 copy and frozen release archive remain unchanged. Private historical QA receipts/screenshots and environment files were excluded from this GitHub delivery. Website deployment alone does not establish public SaaS readiness.

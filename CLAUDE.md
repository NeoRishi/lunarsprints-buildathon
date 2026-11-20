# LunarSprints (NeoRishi Sprints): project context for Claude Code

Claude Code reads this file at the start of every session. Machine-readable facts are in `project-context.json`. Next.js 16 notes are in `AGENTS.md`.

## What the product is

LunarSprints is a Daily Clarity Engine. It answers one question: "Given my goals, deadlines, capacity and commitments, what deserves my attention today?"

* Core promise: "Know what matters today." Key surfaces: MUST MOVE, WHY THIS?, NOT TODAY. (These surfaces are not built yet as of November 2026.)
* It is NOT an astrology app, horoscope app, to-do manager, project-management tool, chatbot or habit-streak app.
* The lunar layer is secondary. The product must stay useful with all lunar features turned off. User reality always overrides lunar context.
* First audience: founders and independent professionals, India first, available worldwide.

## Where things live

| Item | Value |
|---|---|
| GitHub repo | NeoRishi/lunar-sprints (default branch `main`) |
| Local copy | `~/Desktop/LunarSprints` on a MacBook Air |
| Production URL | https://sprints.neorishi.io (app at `/app`, landing page at `/`) |
| Hosting | Vercel, team `neorishis-projects`, project `lunar-sprints`, region Tokyo (`hnd1`) |
| Database and auth | Supabase project "NeoRishi LifeOS" (`NeoRishi-LifeOS-Final`, ref `jhkoxgyxrihsuhpjqkxc`, Tokyo). Shared with other NeoRishi products. Do NOT create a new Supabase project. LunarSprints tables use the `ls_` prefix. |
| Email | Resend (sign-in emails already go through it) |
| DNS | Hostinger, for neorishi.io |
| AI today | OpenAI, project `lunarsprints` (`proj_vI5AtNhbZISblXntDQZHNhZ1`), 10 saved agents, model `gpt-6-astra`, medium reasoning |

## Stack

Next.js App Router (v16, see `AGENTS.md`), TypeScript, plain CSS with Moonlit design tokens in `src/app/globals.css` plus CSS modules (no Tailwind), Supabase (`@supabase/ssr`), Zod, Vitest, Playwright, npm, Node 22 to 24.

Environment variables (names only, never print values): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `OPENAI_PROJECT_ID`, `OPENAI_SMART_MODEL`, `APP_ORIGIN=https://sprints.neorishi.io`.

## The 10 AI agents (current setup)

* The source of truth is `config/agent-registry.json`. Read it; don't trust any copy of it pasted elsewhere.
* Each entry maps a role to a saved OpenAI agent ID and an `instructionsSha256`.
* At runtime `src/features/lunarsprints/agents/managed.ts` re-reads each saved agent and refuses to run if its instruction hash differs from the registry (error `agent_configuration_changed`). The check is in `agents/registry-check.ts`.
* All AI calls go through the `Intelligence` interface in `managed.ts`. The coordinator and tests depend only on that interface.
* Only 7 roles are called today: smart_goal, intent_alignment, story_decomposer, scheduling, adaptive_backlog, daily_execution, reflection. `orchestrator` and `capacity` are never invoked; `rhythm` is disabled.
* Files in `src/features/lunarsprints/agents/prompts/` are short summaries of each agent's instructions, not the full saved text. They refer to a master spec that is not in this repo. Policies are in `agents/policies.ts`.
* Agent 05 (`story_decomposer`) was edited on 6 Nov 2026 to remove the fixed "15-day sprint" sentence. Its hash is now `6eb8815ed6852abdcf9fb9a548bda86c9cbbec0c5451429080afb6abecd24357`. `tests/registry.test.ts` pins it.
* Story decomposition runs on `OPENAI_STORY_MODEL` (default `gpt-6.1-sol`), not the registry model.
* Never create, edit or delete a saved OpenAI agent from code or the dashboard. If a remote change is needed, write the exact prompt for the owner to run in Codex instead.

## Product decisions already taken

* Sprint length: 3 to 45 days overall. Recommended preset: paksha sprints (Pratipada to Purnima or Amavasya). Custom start and end dates allowed. One account can have many sprints over time.
* Free tier: 1 active sprint of 3 to 15 days. LunarSprints+ (coming soon): up to 3 active sprints of up to 45 days. Limits live in `config/plans.json`, not in code, and the landing page reads them from there.
* Payments: on hold. Pricing page shows LunarSprints+ (Rs 299/month) as "coming soon". Do not build payments unless asked.
* Login: one universal NeoRishi login (same LifeOS Supabase auth). Open signup.
* Reminders: email only, through Resend.
* Visual direction: "Moonlit": dark night background, moonlight text, one soft gold accent, thin serif headlines, minimal.
* On-screen language is plain: no "SMART", "Definition of Done", agent names or "semantic replan". Use "Done means", "milestones", "steps", "Adjust the plan".
* Legal pages (Privacy, Terms, Refunds, Contact) exist. Company: NeoRishi Wellness (OPC) Private Limited, Pune 411014.

## Invariants (never break these)

1. Deterministic core: planning and ranking must work with no LLM call. AI assists, it does not decide silently.
2. Never silently rebuild today's plan. Plan revisions are immutable.
3. Reality before lunar context. Never show fake lunar data in production.
4. Preserve Row Level Security. No service-role shortcuts in user paths.
5. Server decides identity and dates. Never trust browser-supplied origin or user ID.
6. Database migrations are additive only. The Supabase project is shared, so touch only LunarSprints tables.
7. No secrets in code, chat, logs or commits.

## Quality guides

* `.claude/skills/ui-quality/SKILL.md`: visual rules for Moonlit screens (tokens only, one accent, no template tells).
* `.claude/skills/copy-quality/SKILL.md`: plain-language glossary, banned words, honest claims.
* `.claude/agents/silent-failure-hunter.md` and `.claude/agents/refactor-cleaner.md`: read-only reviewers.
* `tests/copy-guard.test.ts` runs in `npm test`. It fails on new em-dashes and on-screen jargon. Existing problems are listed in `tests/copy-guard-baseline.json`, which may only shrink.
* Attribution for adapted material: `docs/THIRD_PARTY_NOTICES.md`.

## Working rules

* Work on a branch, open a PR, and stop. The owner reviews and merges. Merging to `main` deploys to production.
* Git: no reset, force push, branch deletion, history rewrite or squashing finished work. If ancestry looks wrong, stop and report.
* Commit identity must be `NeoRishi <hrishikesh.wattamwar@gmail.com>` (with the dot). Never override it.
* Before every PR: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build` all pass.
* Ask before anything hard to undo: database changes on the live project, DNS, Vercel settings, deleting files.
* Stop at the requested phase and report. Don't drift into the next one.

## How the owner wants you to communicate

* Plain language first. Explain decisions simply; technical labels second.
* Ask clarifying questions (multiple choice with a recommended answer) before big work.
* Never use em-dashes in any output, including code comments, docs, UI copy and PR text.
* Flag invented testimonials, fake social proof or unverifiable claims by name and propose honest replacements.
* Call out scope creep and perfectionism-restart cycles when you see them.
